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
  - Grove LCD RGB Backlight (I2C 0x3e text, 0x62 colour), optional: shows cloud status,
    the Pi's IP address and live readings; backlight green = streaming, amber = connecting,
    red = relay down or sensor problem, blue = local-only

Missing or failing sensors are sent as null. Leave the joystick untouched for the
first second after starting so its centre can be calibrated.

Run:   python3 pi/telemetry.py
Cloud: set RELAY_URL (wss://<site>/api/telemetry/push) and RELAY_TOKEN to also push
       every sample to the public site, so it works from any network.
Needs: sudo apt install -y python3-smbus2 python3-websockets   (I2C enabled)
"""
import asyncio
import json
import os
import socket
import time
from datetime import datetime, timezone

from smbus2 import SMBus
from websockets.asyncio.client import connect
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


# One sampler reads the sensors; local viewers and the cloud relay share its latest sample,
# so the I2C bus is never read by two clients at once.
latest = {"json": None, "sample": None}
# Relay state for the LCD: off (not configured), connecting, ok, retry; plus samples sent per second.
relay_state = {"state": "off", "sent": 0, "rate": 0}


# ---------- Grove LCD RGB Backlight (text 0x3e, backlight 0x62) ----------
class GroveLCD:
    """16x2 Grove LCD. Optional: any I2C error turns it off and telemetry carries on."""

    def __init__(self, text_addr=0x3E, rgb_addr=0x62):
        self.text, self.rgb, self.ok, self.shown = text_addr, rgb_addr, False, None
        try:
            time.sleep(0.05)
            for command in (0x01, 0x08 | 0x04, 0x28):    # clear, display on (no cursor), 2 lines
                self._command(command)
                time.sleep(0.005)
            for reg, value in ((0x00, 0x00), (0x01, 0x00), (0x08, 0xAA)):  # PCA9633: wake, PWM all LEDs
                bus.write_byte_data(self.rgb, reg, value)
            self.ok = True
        except OSError as error:
            print("LCD not available:", error)

    def _command(self, value):
        bus.write_byte_data(self.text, 0x80, value)

    def colour(self, r, g, b):
        if not self.ok:
            return
        try:
            bus.write_byte_data(self.rgb, 0x04, r)
            bus.write_byte_data(self.rgb, 0x03, g)
            bus.write_byte_data(self.rgb, 0x02, b)
        except OSError:
            self.ok = False

    def show(self, line1, line2):
        lines = (line1[:16].ljust(16), line2[:16].ljust(16))
        if not self.ok or lines == self.shown:
            return
        try:
            for row, text in enumerate(lines):
                self._command(0x80 if row == 0 else 0xC0)
                for ch in text:
                    bus.write_byte_data(self.text, 0x40, ord(ch) if ord(ch) < 128 else ord('?'))
            self.shown = lines
        except OSError:
            self.ok = False


def local_ip():
    """The Pi's address on the current network (no packets are sent)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("8.8.8.8", 80))
            return probe.getsockname()[0]
    except OSError:
        return "no network"


COLOURS = {"ok": (0, 140, 50), "connecting": (170, 100, 0), "retry": (170, 25, 10), "off": (20, 60, 170)}


async def lcd_status():
    lcd = GroveLCD(int(os.environ.get("LCD_ADDR", "0x3e"), 16), int(os.environ.get("RGB_ADDR", "0x62"), 16))
    if not lcd.ok:
        return
    lcd.colour(*COLOURS["connecting"])
    lcd.show("BaseScout", "starting...")
    tick = 0
    while True:
        relay_state["rate"], relay_state["sent"] = relay_state["sent"], 0
        state = relay_state["state"]
        sample = latest["sample"] or {}
        sensor_fault = sample.get("temp_c") is None and sample.get("light") is None
        lcd.colour(*(COLOURS["retry"] if sensor_fault else COLOURS[state]))
        phase = (tick // 3) % 2                       # alternate every 3 seconds
        if phase == 0:
            line1 = {"ok": f"CLOUD OK {relay_state['rate']:>3}Hz", "connecting": "CLOUD connecting",
                     "retry": "CLOUD retrying..", "off": "LOCAL MODE"}[state]
        else:
            ip = local_ip()
            line1 = f"IP {ip}" if len(ip) <= 13 else ip   # 16-character line
        t, p = sample.get("temp_c"), sample.get("pressure_hpa")
        aq, light = sample.get("air_quality"), sample.get("light")
        if sensor_fault:
            line2 = "SENSOR CHECK"
        elif phase == 0:
            line2 = f"{t if t is not None else '--'}C {round(p) if p is not None else '--'}hPa"
        else:
            line2 = f"AQ {aq if aq is not None else '--'} L {light if light is not None else '--'}"
        lcd.show(line1, line2)
        tick += 1
        await asyncio.sleep(1)


async def sampler():
    while True:
        latest["sample"] = read_sample()
        latest["json"] = json.dumps(latest["sample"])
        await asyncio.sleep(1 / RATE_HZ)


async def handler(ws):
    if ws.request.path != "/telemetry":
        await ws.close(code=1008, reason="use /telemetry")
        return
    print("Local viewer connected")
    try:
        while True:
            if latest["json"]:
                await ws.send(latest["json"])
            await asyncio.sleep(1 / RATE_HZ)
    except Exception:
        print("Local viewer disconnected")


async def relay():
    """Push every sample to the cloud relay so the public site shows live data from anywhere."""
    url, token = os.environ.get("RELAY_URL"), os.environ.get("RELAY_TOKEN")
    if not url or not token:
        print("Cloud relay off (set RELAY_URL and RELAY_TOKEN to enable)")
        relay_state["state"] = "off"
        return
    delay = 1
    relay_state["state"] = "connecting"
    while True:
        try:
            async with connect(url, additional_headers={"Authorization": f"Bearer {token}"},
                               open_timeout=10, ping_interval=20) as ws:
                print(f"Cloud relay connected: {url}")
                relay_state["state"] = "ok"
                delay = 1
                while True:
                    if latest["json"]:
                        await ws.send(latest["json"])
                        relay_state["sent"] += 1
                    await asyncio.sleep(1 / RATE_HZ)
        except Exception as error:
            relay_state["state"] = "retry"
            print(f"Cloud relay disconnected ({type(error).__name__}); retrying in {delay}s")
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30)


async def main():
    print("Sample:", read_sample())
    async with serve(handler, "0.0.0.0", PORT):
        print(f"Telemetry on ws://<this-pi-ip>:{PORT}/telemetry")
        await asyncio.gather(sampler(), relay(), lcd_status())


if __name__ == "__main__":
    asyncio.run(main())
