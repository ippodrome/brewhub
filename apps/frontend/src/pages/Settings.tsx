import { BackupRestore } from "../components/BackupRestore";
import { FirmwareManager } from "../components/FirmwareManager";
import { NotificationSettings } from "../components/NotificationSettings";

const sectionHeadingClass = "font-display text-xl font-semibold text-fg";

export function Settings(): JSX.Element {
  return (
    <div className="page max-w-3xl space-y-10">
      <div>
        <p className="eyebrow">System</p>
        <h1 className="page-title mt-1">Settings</h1>
        <p className="mt-1 text-sm text-muted">Alerts, firmware updates and backups.</p>
      </div>

      <section className="space-y-4">
        <h2 className={sectionHeadingClass}>Notifications</h2>
        <NotificationSettings />
      </section>

      <section className="space-y-4">
        <h2 className={sectionHeadingClass}>Firmware</h2>
        <FirmwareManager />
      </section>

      <section className="space-y-4">
        <h2 className={sectionHeadingClass}>Backup &amp; restore</h2>
        <BackupRestore />
      </section>
    </div>
  );
}
