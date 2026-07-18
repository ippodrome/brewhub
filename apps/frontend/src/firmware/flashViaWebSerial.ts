import { ESPLoader, Transport } from "esptool-js";

// Arduino-ESP32's default OTA-capable partition scheme (default.csv, pinned
// explicitly in every firmware/*/platformio.ini — see DECISIONS.md) puts
// the app partition (app0/ota_0) at this fixed offset. This flashes ONLY
// the app image, not bootloader.bin/partitions.bin — it assumes the board
// already has a compatible bootloader+partition table from a prior flash
// (e.g. via `pio run -t upload`, per the README's existing "Adding a
// device" flow), not a factory-blank chip. See README "Firmware / flashing"
// for that boundary spelled out.
const APP_PARTITION_OFFSET = 0x10000;
const BAUD_RATE = 115200;

export function isWebSerialSupported(): boolean {
  return "serial" in navigator;
}

export interface FlashProgress {
  written: number;
  total: number;
}

export async function flashViaWebSerial(
  firmwareBytes: ArrayBuffer,
  onLog: (line: string) => void,
  onProgress: (progress: FlashProgress) => void,
): Promise<void> {
  if (!isWebSerialSupported()) {
    throw new Error("WebSerial isn't available in this browser — use Chrome or Edge.");
  }

  const port = await navigator.serial.requestPort();
  const transport = new Transport(port, true);

  const loader = new ESPLoader({
    transport,
    baudrate: BAUD_RATE,
    terminal: {
      clean: () => {},
      writeLine: (data: string) => onLog(data),
      write: (data: string) => onLog(data),
    },
  });

  await loader.main();

  await loader.writeFlash({
    fileArray: [{ data: new Uint8Array(firmwareBytes), address: APP_PARTITION_OFFSET }],
    flashMode: "keep",
    flashFreq: "keep",
    flashSize: "keep",
    eraseAll: false,
    compress: true,
    reportProgress: (_fileIndex: number, written: number, total: number) => {
      onProgress({ written, total });
    },
  });

  await loader.after();
}
