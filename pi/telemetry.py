"""BaseScout Live Earth demo telemetry server for the Raspberry Pi 5.

Streams one JSON message per sample on ws://<pi-ip>:8765/telemetry, matching the
contract in the main README:

  {"timestamp": "...Z", "uv": null, "light": 1234, "air_quality": 567,
   "temp_c": 22.5, "pressure_hpa": 1013.2, "joystick_x": 0.0, "joystick_y": 0.0}

Hardware (Seeed Grove):
  - Grove Base Hat for Raspberry Pi  (ADC at I2C 0x04)
      A0 -> Grove Thumb Joystick   (channel 0 = X, channel 1 = Y)
      A2 -> Grove Light Sensor     (raw 12-bit ADC value)
      A6 -> Grove Air Quality      (raw 12-bit ADC value)
  - Grove High Precision Barometer DPS310 (I2C 0x77) -> temp_c, pressure_hpa

Missing or failing sensors are sent as null. Leave the joystick untouched for the
first second after starting so its centre can be calibrated.

Run:   python3 pi/telemetry.py
Needs: sudo apt install -y python3-smbus2 python3-websockets   (I2C enabled)
"""
import asyncio
import json
import os
import time
from datetime import datetime, timezone

from smbus2 import SMBus
from websockets.asyncio.server import serve

HAT_ADDR = int(os.environ.get("HAT_ADDR", "0x04"), 16)
DPS_ADDR = int(os.environ.get("DPS_ADDR", "0x77"), 16)
# Hat analog channels: port A0 = ch0/1, A2 = ch2/3, A4 = ch4/5, A6 = ch6/7. Override with env vars.
JOY_X = int(os.environ.get("JOY_X_CH", "0"))
JOY_Y = int(os.environ.get("JOY_Y_CH", "1"))
LIGHT = int(os.environ.get("LIGHT_CH", "2"))
AIR = int(os.environ.get("AIR_CH", "6"))
PORT = int(os.environ.get("TELEMETRY_PORT", "8765"))
RATE_HZ = float(os.environ.get("TELEMETRY_HZ", "15"))

bus = SMBus(1)


# ---------- Grove Base Hat ADC ----------
def adc_raw(channel):
    """12-bit raw value (0-4095), register 0x10 + channel, little-endian."""
    lo, hi = bus.read_i2c_block_data(HAT_ADDR, 0x10 + channel, 2)
    return lo | (hi << 8)


def adc(channel):
    try:
        return adc_raw(channel)
    except OSError:
        return None


# ---------- DPS310 barometer ----------
def twos(value, bits):
    return value - (1 << bits) if value & (1 << (bits - 1)) else value


class DPS310:
    SCALE = 7864320  # compensation scale factor for 8x oversampling

    def __init__(self, addr):
        self.addr = addr
        write = lambda reg, val: bus.write_byte_data(addr, reg, val)
        write(0x0C, 0x89)  # soft reset
        time.sleep(0.05)
        # Vendor workaround for chips that report a wrong temperature after reset.
        for reg, val in ((0x0E, 0xA5), (0x0F, 0x96), (0x62, 0x02), (0x0E, 0x00), (0x0F, 0x00)):
            write(reg, val)
        for _ in range(50):  # wait for coefficients and sensor ready
            if bus.read_byte_data(addr, 0x08) & 0xC0 == 0xC0:
                break
            time.sleep(0.02)
        b = bus.read_i2c_block_data(addr, 0x10, 18)
        self.c0 = twos((b[0] << 4) | (b[1] >> 4), 12)
        self.c1 = twos(((b[1] & 0x0F) << 8) | b[2], 12)
        self.c00 = twos((b[3] << 12) | (b[4] << 4) | (b[5] >> 4), 20)
        self.c10 = twos(((b[5] & 0x0F) << 16) | (b[6] << 8) | b[7], 20)
        self.c01, self.c11, self.c20, self.c21, self.c30 = (
            twos((b[i] << 8) | b[i + 1], 16) for i in (8, 10, 12, 14, 16)
        )
        external = bus.read_byte_data(addr, 0x28) & 0x80  # temperature sensor the coefficients use
        write(0x06, 0x23)             # pressure: 4 Hz, 8x oversampling
        write(0x07, 0x23 | external)  # temperature: 4 Hz, 8x oversampling
        write(0x09, 0x00)             # no result shift needed at 8x
        write(0x08, 0x07)             # continuous pressure + temperature
        time.sleep(0.3)

    def read(self):
        d = bus.read_i2c_block_data(self.addr, 0x00, 6)
        p = twos((d[0] << 16) | (d[1] << 8) | d[2], 24) / self.SCALE
        t = twos((d[3] << 16) | (d[4] << 8) | d[5], 24) / self.SCALE
        temp_c = self.c0 * 0.5 + self.c1 * t
        pascal = (self.c00 + p * (self.c10 + p * (self.c20 + p * self.c30))
                  + t * self.c01 + t * p * (self.c11 + p * self.c21))
        return round(temp_c, 2), round(pascal / 100, 2)


try:
    barometer = DPS310(DPS_ADDR)
except OSError as error:
    print("DPS310 not available:", error)
    barometer = None


def environment():
    if barometer is None:
        return None, None
    try:
        return barometer.read()
    except OSError:
        return None, None


# ---------- Joystick ----------
def calibrate():
    samples = []
    for _ in range(20):
        x, y = adc(JOY_X), adc(JOY_Y)
        if x is not None and y is not None:
            samples.append((x, y))
        time.sleep(0.05)
    if not samples:
        return 2048.0, 2048.0
    return (sum(s[0] for s in samples) / len(samples),
            sum(s[1] for s in samples) / len(samples))


CENTRE_X, CENTRE_Y = calibrate()
print(f"Joystick centre x={CENTRE_X:.0f} y={CENTRE_Y:.0f}")


def axis(value, centre):
    """Map a raw reading to -1..+1 around the calibrated centre."""
    if value is None:
        return None
    span = centre if value < centre else 4095 - centre
    if not span:
        return 0.0
    return round(max(-1.0, min(1.0, (value - centre) / span)), 3)


def read_sample():
    x = adc(JOY_X)
    if x is not None and x > 4000:  # pressing the stick button pegs X high; ignore it
        x = CENTRE_X
    temp_c, pressure_hpa = environment()
    return {
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "uv": None,  # no UV sensor connected
        "light": adc(LIGHT),
        "air_quality": adc(AIR),
        "temp_c": temp_c,
        "pressure_hpa": pressure_hpa,
        "joystick_x": axis(x, CENTRE_X),
        "joystick_y": axis(adc(JOY_Y), CENTRE_Y),
    }


async def handler(ws):
    if ws.request.path != "/telemetry":
        await ws.close(code=1008, reason="use /telemetry")
        return
    print("BaseScout connected")
    try:
        while True:
            await ws.send(json.dumps(read_sample()))
            await asyncio.sleep(1 / RATE_HZ)
    except Exception:
        print("BaseScout disconnected")


async def main():
    print("Sample:", read_sample())
    async with serve(handler, "0.0.0.0", PORT):
        print(f"Telemetry on ws://<this-pi-ip>:{PORT}/telemetry")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
