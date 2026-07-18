import { BackupRestore } from "../components/BackupRestore";
import { NotificationSettings } from "../components/NotificationSettings";

export function Settings(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Settings</h1>
      <NotificationSettings />
      <BackupRestore />
    </div>
  );
}
