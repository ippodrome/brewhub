import { BackupRestore } from "../components/BackupRestore";
import { FirmwareManager } from "../components/FirmwareManager";
import { NotificationSettings } from "../components/NotificationSettings";

const sectionHeadingClass = "text-xs font-medium uppercase tracking-wide text-neutral-600 dark:text-neutral-500";

export function Settings(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <h1 className="font-display text-2xl font-semibold text-neutral-900 dark:text-neutral-100">Settings</h1>

      <section className="space-y-3">
        <h2 className={sectionHeadingClass}>Notifications</h2>
        <NotificationSettings />
      </section>

      <section className="space-y-3">
        <h2 className={sectionHeadingClass}>Firmware</h2>
        <FirmwareManager />
      </section>

      <section className="space-y-3">
        <h2 className={sectionHeadingClass}>Backup &amp; restore</h2>
        <BackupRestore />
      </section>
    </div>
  );
}
