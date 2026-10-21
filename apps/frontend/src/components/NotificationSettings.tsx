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
  "field px-2.5 py-1.5 text-sm";
const labelClass = "text-xs text-dim";

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
      <p className="text-xs text-dim">
        Browser push isn't available here — needs Chrome, Edge, or Firefox over HTTPS.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-dim">
        {subQuery.data
          ? "This browser is subscribed to push notifications."
          : "This browser is not yet subscribed."}
      </p>
      {error && <p className="text-xs text-crit">{error}</p>}
      {subQuery.data ? (
        <button
          onClick={() => unsubscribeMutation.mutate()}
          disabled={unsubscribeMutation.isPending}
          className="rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-tint hover:text-fg disabled:opacity-50"
        >
          {unsubscribeMutation.isPending ? "Unsubscribing..." : "Unsubscribe this browser"}
        </button>
      ) : (
        <button
          onClick={() => subscribeMutation.mutate()}
          disabled={subscribeMutation.isPending || !vapidPublicKey}
          className="btn-primary px-3 py-1.5 text-xs"
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

  if (settingsQuery.isLoading) return <p className="text-sm text-dim">Loading...</p>;
  if (!settingsQuery.data) return <p className="text-sm text-crit">Could not load notification settings.</p>;

  return (
    <div className="space-y-6">
      <p className="text-xs text-dim">
        BrewHub notifies you when a device goes offline, or when a keg's remaining volume drops low — over any
        channels you enable below.
      </p>

      <div className="card space-y-3 p-5">
        <h3 className="font-display text-base font-semibold text-fg">Browser push</h3>
        <PushSection vapidPublicKey={settingsQuery.data.vapidPublicKey} />
      </div>

      <form onSubmit={handleSubmit} className="card space-y-3 p-5">
        <h3 className="font-display text-base font-semibold text-fg">Telegram</h3>
        <p className="text-xs text-dim">
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

        <p className="pt-2 text-sm font-medium text-muted">Discord</p>
        <p className="text-xs text-dim">Server settings → Integrations → Webhooks → New Webhook → copy its URL.</p>
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
            {testMutation.isSuccess && <p className="text-xs text-ok">Test notification sent.</p>}
            {testMutation.isError && <p className="text-xs text-crit">Test failed to send.</p>}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
              className="rounded-xl px-3 py-1.5 text-xs text-muted hover:bg-tint hover:text-fg disabled:opacity-50"
            >
              {testMutation.isPending ? "Sending..." : "Send test notification"}
            </button>
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="btn-primary px-3 py-1.5 text-xs"
            >
              {saveMutation.isPending ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
