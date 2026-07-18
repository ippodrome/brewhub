import { useState } from "react";
import { DeviceList } from "../components/DeviceList";
import { AddDeviceModal } from "../components/AddDeviceModal";

export function Devices(): JSX.Element {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-neutral-900 dark:text-neutral-100">Devices</h1>
        <button
          onClick={() => setAddOpen(true)}
          className="rounded-xl bg-amber-500 hover:bg-amber-400 dark:bg-amber-500 dark:hover:bg-amber-400 px-3 py-1.5 text-sm font-medium text-zinc-950"
        >
          Add device
        </button>
      </div>

      <DeviceList />

      {addOpen && <AddDeviceModal onClose={() => setAddOpen(false)} />}
    </div>
  );
}
