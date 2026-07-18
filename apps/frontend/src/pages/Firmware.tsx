import { FirmwareManager } from "../components/FirmwareManager";

export function Firmware(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="font-display text-2xl font-semibold text-neutral-900 dark:text-neutral-100">Firmware</h1>
      <FirmwareManager />
    </div>
  );
}
