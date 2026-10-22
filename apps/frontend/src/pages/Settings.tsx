import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BackupRestore } from "../components/BackupRestore";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { FirmwareManager } from "../components/FirmwareManager";
import { MqttBrokerSettings } from "../components/MqttBrokerSettings";
import { NotificationSettings } from "../components/NotificationSettings";
import { UpdateManager } from "../components/UpdateManager";
import { listFirmwareBuilds } from "../api/firmware";
import { getMqttBroker } from "../api/mqtt";
import { getNotificationSettings } from "../api/notifications";
import { getUpdateStatus } from "../api/system";
import { useUpdateCheck } from "../hooks/useUpdateCheck";
import {
  OPEN_SECTIONS_STORAGE_KEY,
  firmwareSummary,
  mqttSummary,
  notificationsSummary,
  parseOpenSections,
  sectionFromHash,
  toggleSection,
  updatesAttentionKey,
  updatesSummary,
  type SettingsSectionId,
} from "../lib/settings-sections";

function readStored(): SettingsSectionId[] {
  try {
    return parseOpenSections(window.localStorage.getItem(OPEN_SECTIONS_STORAGE_KEY));
  } catch {
    return [];
  }
}

function useOpenSections() {
  const [open, setOpen] = useState<SettingsSectionId[]>(() => {
    const stored = readStored();
    const fromHash = sectionFromHash(window.location.hash);
    return fromHash ? toggleSection(stored, fromHash, true) : stored;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(OPEN_SECTIONS_STORAGE_KEY, JSON.stringify(open));
    } catch {
      /* private mode / quota — remembering is best-effort */
    }
  }, [open]);

  // Deep links: open and scroll to the section named in the hash.
  useEffect(() => {
    const go = () => {
      const id = sectionFromHash(window.location.hash);
      if (!id) return;
      setOpen((prev) => toggleSection(prev, id, true));
      requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, []);

  const set = useCallback((id: SettingsSectionId, next: boolean) => setOpen((prev) => toggleSection(prev, id, next)), []);
  return { isOpen: (id: SettingsSectionId) => open.includes(id), set };
}

export function Settings(): JSX.Element {
  const { isOpen, set } = useOpenSections();

  // Same query keys as the cards themselves, so these share one cache entry.
  const mqtt = useQuery({ queryKey: ["mqtt-broker"], queryFn: getMqttBroker, retry: false });
  const notifications = useQuery({ queryKey: ["notification-settings"], queryFn: getNotificationSettings });
  const firmware = useQuery({ queryKey: ["firmware"], queryFn: () => listFirmwareBuilds() });
  const { version, check } = useUpdateCheck();
  const updateStatus = useQuery({
    queryKey: ["update-status"],
    queryFn: getUpdateStatus,
    enabled: version.data?.updaterConfigured === true,
    retry: false,
  });

  // Open the Updates card once when there is something to act on; the
  // header still toggles it afterwards.
  const attention = updatesAttentionKey(check.data, updateStatus.data);
  useEffect(() => {
    if (attention) set("updates", true);
  }, [attention, set]);

  return (
    <div className="page max-w-3xl space-y-6">
      <div className="mb-4">
        <p className="eyebrow">System</p>
        <h1 className="page-title mt-1">Settings</h1>
        <p className="mt-1 text-sm text-muted">Alerts, MQTT broker, app and firmware updates, and backups.</p>
      </div>

      <CollapsibleSection
        id="notifications"
        title="Notifications"
        summary={notifications.isError ? "Couldn't load settings" : notificationsSummary(notifications.data)}
        open={isOpen("notifications")}
        onToggle={(n) => set("notifications", n)}
      >
        <NotificationSettings />
      </CollapsibleSection>

      <CollapsibleSection
        id="mqtt"
        title="MQTT"
        summary={mqtt.isError ? "Couldn't load broker status" : mqttSummary(mqtt.data)}
        open={isOpen("mqtt")}
        onToggle={(n) => set("mqtt", n)}
      >
        <MqttBrokerSettings />
      </CollapsibleSection>

      <CollapsibleSection
        id="updates"
        title="Updates"
        summary={
          version.data && !version.data.updaterConfigured
            ? `Installed ${version.data.version} · updater not configured`
            : updatesSummary(version.data?.version, check.data, updateStatus.data)
        }
        open={isOpen("updates")}
        onToggle={(n) => set("updates", n)}
      >
        <UpdateManager />
      </CollapsibleSection>

      <CollapsibleSection
        id="firmware"
        title="Firmware"
        summary={firmware.isError ? "Couldn't load builds" : firmwareSummary(firmware.data)}
        open={isOpen("firmware")}
        onToggle={(n) => set("firmware", n)}
      >
        <FirmwareManager />
      </CollapsibleSection>

      <CollapsibleSection
        id="backup"
        title="Backup & restore"
        summary="Download a backup or restore from a file"
        open={isOpen("backup")}
        onToggle={(n) => set("backup", n)}
      >
        <BackupRestore />
      </CollapsibleSection>
    </div>
  );
}
