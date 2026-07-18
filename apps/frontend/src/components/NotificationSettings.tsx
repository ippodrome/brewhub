import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getNotificationSettings,
  sendTestNotification,
  subscribeToPush as apiSubscribeToPush,
  unsubscribeFromPush as apiUnsubscribeFromPush,
  updateNotificationSettings,
} from "../api/notifications";
import {
  getCurrentSubscription,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPushLocally,
} from "../notifications/pushSubscribe";

const inputClass =
  "w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500";
const labelClass = "text-xs text-neutral-600 dark:text-neutral-500";

function PushSection({ vapidPublicKey }: { vapidPublicKey: string | null }): JSX.Element {
  const queryClient = useQueryClient();
  const subQuery = useQuery({ queryKey: ["push-subscription"], queryFn: getCurrentSubscription });
  const [error, setError] = useState<string | null>(null);

  const subscribeMutation = useMutation({
    mutationFn: async () => {
      if (!vapidPublicKey) throw new Error("Backend hasn't generated a VAPID key yet");
      const sub = await subscribeToPush(vapidPublicKey);
      await apiSubscribeToPush(sub);
      return sub;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["push-subscription"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to subscribe"),
  });

  const unsubscribeMutation = useMutation({
    mutationFn: async () => {
      const endpoint = await unsubscribeFromPushLocally();
      if (endpoint) await apiUnsubscribeFromPush(endpoint);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["push-subscription"] }),
  });

  if (!isPushSupported()) {
    return (
      <p className="text-xs text-neutral-600 dark:text-neutral-500">
        Browser push isn't available here — needs Chrome, Edge, or Firefox over HTTPS.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-neutral-600 dark:text-neutral-500">
        {subQuery.data
          ? "This browser is subscribed to push notifications."
          : "This browser is not yet subscribed."}
      </p>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {subQuery.data ? (
        <button
          onClick={() => unsubscribeMutation.mutate()}
          disabled={unsubscribeMutation.isPending}
          className="rounded-xl px-2.5 py-1 text-xs text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200 disabled:opacity-50"
        >
          {unsubscribeMutation.isPending ? "Unsubscribing..." : "Unsubscribe this browser"}
        </button>
      ) : (
        <button
          onClick={() => subscribeMutation.mutate()}
          disabled={subscribeMutation.isPending || !vapidPublicKey}
          className="rounded-xl bg-amber-500 hover:bg-amber-400 dark:bg-amber-500 dark:hover:bg-amber-400 px-3 py-1.5 text-xs font-medium text-zinc-950 disabled:opacity-50"
        >
          {subscribeMutation.isPending ? "Subscribing..." : "Enable push notifications"}
        </button>
      )}
    </div>
  );
}

export function NotificationSettings(): JSX.Element {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["notification-settings"], queryFn: getNotificationSettings });

  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState("");
  const [formInitialized, setFormInitialized] = useState(false);

  if (settingsQuery.data && !formInitialized) {
    setTelegramBotToken(settingsQuery.data.telegramBotToken ?? "");
    setTelegramChatId(settingsQuery.data.telegramChatId ?? "");
    setDiscordWebhookUrl(settingsQuery.data.discordWebhookUrl ?? "");
    setFormInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      updateNotificationSettings({
        telegramBotToken: telegramBotToken || null,
        telegramChatId: telegramChatId || null,
        discordWebhookUrl: discordWebhookUrl || null,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-settings"] }),
  });

  const testMutation = useMutation({ mutationFn: sendTestNotification });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    saveMutation.mutate();
  }

  if (settingsQuery.isLoading) return <p className="text-sm text-neutral-600 dark:text-neutral-500">Loading...</p>;
  if (!settingsQuery.data) return <p className="text-sm text-red-600 dark:text-red-400">Could not load notification settings.</p>;

  return (
    <div className="space-y-6">
      <p className="text-xs text-neutral-600 dark:text-neutral-500">
        BrewHub notifies you when a device goes offline, or when a keg's remaining volume drops low — over any
        channels you enable below.
      </p>

      <div className="space-y-3 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
        <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Browser push</p>
        <PushSection vapidPublicKey={settingsQuery.data.vapidPublicKey} />
      </div>

      <form onSubmit={handleSubmit} className="space-y-3 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
        <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Telegram</p>
        <p className="text-xs text-neutral-600 dark:text-neutral-500">
          Message <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="underline">@BotFather</a> on
          Telegram to create a bot and get a token; message your new bot once, then check{" "}
          <code>https://api.telegram.org/bot&lt;token&gt;/getUpdates</code> to find your chat id.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className={labelClass}>Bot token</label>
            <input
              className={inputClass}
              placeholder="123456:ABC-DEF..."
              value={telegramBotToken}
              onChange={(e) => setTelegramBotToken(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Chat ID</label>
            <input
              className={inputClass}
              placeholder="123456789"
              value={telegramChatId}
              onChange={(e) => setTelegramChatId(e.target.value)}
            />
          </div>
        </div>

        <p className="pt-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">Discord</p>
        <p className="text-xs text-neutral-600 dark:text-neutral-500">Server settings → Integrations → Webhooks → New Webhook → copy its URL.</p>
        <div className="space-y-1">
          <label className={labelClass}>Webhook URL</label>
          <input
            className={inputClass}
            placeholder="https://discord.com/api/webhooks/..."
            value={discordWebhookUrl}
            onChange={(e) => setDiscordWebhookUrl(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between pt-2">
          <div>
            {testMutation.isSuccess && <p className="text-xs text-emerald-600 dark:text-emerald-400">Test notification sent.</p>}
            {testMutation.isError && <p className="text-xs text-red-600 dark:text-red-400">Test failed to send.</p>}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
              className="rounded-xl px-3 py-1.5 text-xs text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200 disabled:opacity-50"
            >
              {testMutation.isPending ? "Sending..." : "Send test notification"}
            </button>
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="rounded-xl bg-amber-500 hover:bg-amber-400 dark:bg-amber-500 dark:hover:bg-amber-400 px-3 py-1.5 text-xs font-medium text-zinc-950 disabled:opacity-50"
            >
              {saveMutation.isPending ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
