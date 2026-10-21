import { useState } from "react";
import { Plus } from "lucide-react";
import { DeviceList } from "../components/DeviceList";
import { AddDeviceModal } from "../components/AddDeviceModal";

export function Devices(): JSX.Element {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="page max-w-3xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Manage</p>
          <h1 className="page-title mt-1">Devices</h1>
          <p className="mt-1 text-sm text-muted">Configure controllers, sensors, taps and profiles.</p>
        </div>
        <button onClick={() => setAddOpen(true)} className="btn-primary">
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Add device
        </button>
      </div>

      <DeviceList onAdd={() => setAddOpen(true)} />

      {addOpen && <AddDeviceModal onClose={() => setAddOpen(false)} />}
    </div>
  );
}
