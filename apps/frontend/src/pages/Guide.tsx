import { useState } from "react";

interface Section {
  id: string;
  title: string;
}

const SECTIONS: Section[] = [
  { id: "getting-started", title: "Getting started" },
  { id: "adding-a-device", title: "Adding a device" },
  { id: "fermenter-control", title: "Fermenter control" },
  { id: "profiles", title: "Profiles" },
  { id: "kegerator-taps", title: "Kegerator & taps" },
  { id: "gravity", title: "Gravity & hydrometers" },
  { id: "firmware", title: "Firmware & updates" },
  { id: "notifications", title: "Notifications" },
  { id: "home-assistant", title: "Home Assistant" },
  { id: "backup", title: "Backup & restore" },
  { id: "troubleshooting", title: "Troubleshooting" },
];

const h2 = "text-lg font-semibold text-neutral-900 dark:text-neutral-100 scroll-mt-6";
const p = "text-sm leading-relaxed text-neutral-700 dark:text-neutral-300";
const label = "text-sm font-medium text-neutral-800 dark:text-neutral-200";
const card = "space-y-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4";

function NavLink({ id, title, active, onClick }: { id: string; title: string; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <a
      href={`#${id}`}
      onClick={onClick}
      className={`block rounded-lg px-3 py-1.5 text-sm transition-colors ${
        active
          ? "bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
          : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
      }`}
    >
      {title}
    </a>
  );
}

export function Guide(): JSX.Element {
  const [active, setActive] = useState(SECTIONS[0]!.id);

  return (
    <div className="mx-auto flex max-w-6xl gap-8 p-6">
      <nav className="hidden w-48 shrink-0 lg:block">
        <div className="sticky top-6 space-y-0.5">
          <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-500">
            On this page
          </p>
          {SECTIONS.map((s) => (
            <NavLink key={s.id} id={s.id} title={s.title} active={active === s.id} onClick={() => setActive(s.id)} />
          ))}
        </div>
      </nav>

      <div className="min-w-0 flex-1 space-y-12 pb-24">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">Guide</h1>
          <p className={`${p} mt-1`}>Everything you need to run BrewHub day to day — no code, just brewing.</p>
        </div>

        <section id="getting-started" className="space-y-3">
          <h2 className={h2}>Getting started</h2>
          <p className={p}>
            BrewHub controls kegerators and fermentation chambers, and is built around one core idea: <strong>the
            ESP32 on each device is always in charge of its own relays.</strong> The dashboard here never tells a
            device "turn the compressor on right now" — it only ever says "here is the setpoint and mode you should
            be running." That means if your WiFi drops, or this server is down, or your phone loses signal — whatever
            a device was last told to do keeps happening. Nothing gets stuck on or off because a message didn't
            arrive. That's a deliberate design choice, not a limitation: temperature control should never depend on
            anything staying online.
          </p>
          <p className={p}>
            The <strong>Dashboard</strong> gives you an at-a-glance view of every device. <strong>Devices</strong> is
            where you configure, monitor, and manage each one individually — that's where you'll spend most of your
            time.
          </p>
        </section>

        <section id="adding-a-device" className="space-y-3">
          <h2 className={h2}>Adding a device</h2>
          <p className={p}>
            Once a physical device has been flashed with BrewHub firmware and connects to your WiFi and MQTT broker
            at least once, it announces itself automatically. Go to <strong>Devices → Add device</strong> and it'll
            show up as a one-click pick in the list — no need to type its id by hand. It only needs to have connected
            once; it doesn't need to be online right now.
          </p>
          <div className={card}>
            <p className={label}>Device types</p>
            <ul className={`${p} list-disc space-y-1 pl-5`}>
              <li><strong>Fermenter</strong> — temperature control for a fermentation chamber, with profiles.</li>
              <li><strong>Kegerator</strong> — cooling control plus tap/pour tracking.</li>
              <li><strong>Keg Scale</strong> — a load-cell platform under a keg, used by weight-measured taps.</li>
              <li><strong>Gravity Bridge</strong> — scans for Tilt/Rapt Pill hydrometers over Bluetooth and reports their readings; it isn't controlled itself, it just feeds data in.</li>
            </ul>
          </div>
        </section>

        <section id="fermenter-control" className="space-y-3">
          <h2 className={h2}>Fermenter control</h2>
          <p className={p}>
            Open a fermenter's <strong>Configure</strong> panel to set how it controls temperature:
          </p>
          <div className={card}>
            <p className={label}>Thermostat mode</p>
            <p className={p}>
              Simple on/off control with a deadband: heating or cooling switches on once the temperature drifts
              past the setpoint by the <strong>hysteresis</strong> amount, and switches off once it's back within
              range. A small hysteresis (e.g. 0.3°C) keeps temperature tighter but cycles the compressor/heater more
              often; a larger one is gentler on the hardware but lets temperature drift further. <strong>Min
              on-time</strong> and <strong>min off-time</strong> stop short-cycling — the compressor won't be asked
              to switch again within that window even if the temperature would otherwise call for it, which protects
              the compressor from damage.
            </p>
          </div>
          <div className={card}>
            <p className={label}>PID mode</p>
            <p className={p}>
              Proportional-Integral-Derivative control — instead of a hard on/off, it continuously adjusts how
              aggressively to heat or cool based on how far off (and how fast changing) the temperature is. Smoother
              than thermostat mode, but the gains (<strong>Kp, Ki, Kd</strong>) need tuning to your specific chamber
              — defaults of zero mean "off," so PID mode does nothing useful until you've set real values. If you're
              not sure, start with thermostat mode; it's simpler to reason about and hard to get wrong.
            </p>
          </div>
        </section>

        <section id="profiles" className="space-y-3">
          <h2 className={h2}>Profiles</h2>
          <p className={p}>
            A profile lets a fermenter's setpoint change automatically over the course of a fermentation, instead of
            staying fixed. Create one from a fermenter's <strong>Profiles</strong> tab, then hit <strong>Activate</strong> to
            start following it — the resolved setpoint updates automatically from then on, and you can always click
            <strong> Stop following a profile</strong> to go back to manual control.
          </p>
          <div className={card}>
            <p className={label}>Time-based</p>
            <p className={p}>
              Each step is "at this many days/hours/minutes after the profile starts, aim for this temperature."
              Between two steps, the setpoint moves smoothly (linear interpolation) — e.g. a step at 18°C on day 0
              and another at 20°C on day 3 means the target rises gradually over those three days, not jumping at
              the end. Set two steps to the <em>same</em> temperature to hold flat for a stretch, and two steps at
              the <em>same</em> time with different temperatures for a fast/near-instant jump (e.g. a diacetyl rest).
            </p>
          </div>
          <div className={card}>
            <p className={label}>Gravity-based</p>
            <p className={p}>
              Same idea, but steps are keyed to measured specific gravity instead of elapsed time — useful when
              fermentation speed varies batch to batch and you want the temperature ramp to follow actual progress,
              not a clock. Requires a hydrometer (Tilt, Rapt Pill, or iSpindel) assigned to that fermenter first —
              see <a href="#gravity" className="underline">Gravity & hydrometers</a> below. Steps are naturally
              authored high-to-low (original gravity down to final gravity).
            </p>
          </div>
        </section>

        <section id="kegerator-taps" className="space-y-3">
          <h2 className={h2}>Kegerator & taps</h2>
          <p className={p}>
            A kegerator device controls chamber cooling the same way a fermenter does (thermostat only, no profiles).
            Its <strong>Taps</strong> tab tracks what's actually on tap and how much is left.
          </p>
          <div className={card}>
            <p className={label}>Flow-measured taps</p>
            <p className={p}>
              For kegerators wired with an inline flow meter — remaining volume is tracked by counting pulses as beer
              is poured, and each pour gets logged with a start/end time and volume for a pour history.
            </p>
          </div>
          <div className={card}>
            <p className={label}>Weight-measured taps</p>
            <p className={p}>
              For kegs sitting on a load-cell platform (a separate Keg Scale device) — remaining volume is worked
              out from the current weight against the keg's known empty/full weights. Needs the scale calibrated
              first (see its device card) and tared with nothing but the empty platform on it before a keg goes on.
            </p>
          </div>
          <p className={p}>
            Either way, you'll get a notification automatically once a tap drops below 15% remaining — see{" "}
            <a href="#notifications" className="underline">Notifications</a>.
          </p>
        </section>

        <section id="gravity" className="space-y-3">
          <h2 className={h2}>Gravity & hydrometers</h2>
          <p className={p}>
            Add a hydrometer from a fermenter's <strong>Hydrometer</strong> tab to track gravity over the course of a
            batch, and optionally drive a gravity-based profile from it.
          </p>
          <div className={card}>
            <p className={label}>Tilt / Rapt Pill (Bluetooth)</p>
            <p className={p}>
              Needs a <strong>Gravity Bridge</strong> device — a small ESP32 flashed with BrewHub's Bluetooth-scanning
              firmware, placed within range of the fermenter. It finds nearby Tilt/Rapt Pill hydrometers automatically
              and reports what it sees, no pairing required. Add the hydrometer using the identifier the bridge
              reports for it (a colour for Tilt, e.g. <code>tilt-red</code>; a device id for Rapt Pill).
            </p>
          </div>
          <div className={card}>
            <p className={label}>iSpindel (WiFi)</p>
            <p className={p}>
              No bridge needed — configure the iSpindel itself (in its own web interface) to POST directly to this
              server, with its units set to Celsius. Add a hydrometer with the identifier matching the name you gave
              the iSpindel.
            </p>
          </div>
          <p className={p}>
            If a hydrometer's readings drift from a manual check, use the calibration slope/offset fields on its tab
            to correct it — applied automatically to every future reading, no need to re-add it.
          </p>
        </section>

        <section id="firmware" className="space-y-3">
          <h2 className={h2}>Firmware & updates</h2>
          <p className={p}>
            The <strong>Firmware</strong> page covers both getting BrewHub onto a brand new board and updating one
            that's already running.
          </p>
          <div className={card}>
            <p className={label}>Initial flash (WebSerial)</p>
            <p className={p}>
              Connect a board over USB, upload its <code>.bin</code> file, and flash it directly from your browser —
              no separate tools needed. Requires Chrome or Edge (WebSerial isn't available in Safari or Firefox).
            </p>
          </div>
          <div className={card}>
            <p className={label}>Over-the-air updates</p>
            <p className={p}>
              For a board that's already paired and online, push a new build to it over WiFi instead — no physical
              access needed. Only enabled once a build's tagged device id matches a device you've actually added.
            </p>
          </div>
        </section>

        <section id="notifications" className="space-y-3">
          <h2 className={h2}>Notifications</h2>
          <p className={p}>
            The <strong>Settings</strong> page notifies you when a device goes offline or a keg drops below 15%
            remaining, over any combination of browser push, Telegram, or Discord. "Send test notification" fires
            all configured channels at once, so you can confirm setup without waiting for something to actually
            happen.
          </p>
        </section>

        <section id="home-assistant" className="space-y-3">
          <h2 className={h2}>Home Assistant</h2>
          <p className={p}>
            If Home Assistant is on the same MQTT broker as BrewHub, every device and tap shows up there
            automatically as its own entity — no YAML, nothing to install. This works even if you never open
            BrewHub's own dashboard again; it's a one-way export, always on.
          </p>
        </section>

        <section id="backup" className="space-y-3">
          <h2 className={h2}>Backup & restore</h2>
          <p className={p}>
            The Settings page has <strong>Download backup</strong> and <strong>Restore from backup</strong> buttons
            covering everything — devices, taps, profiles, history, settings, all of it, in one file. Restoring
            automatically saves a safety copy of what was there before first, so an accidental restore is always
            recoverable. The server keeps running on the old data until you restart it after a restore — that's
            expected, not a bug.
          </p>
        </section>

        <section id="troubleshooting" className="space-y-3">
          <h2 className={h2}>Troubleshooting</h2>
          <div className={card}>
            <p className={label}>A device shows offline but I know it's powered on</p>
            <p className={p}>
              Check its WiFi and MQTT broker credentials (baked in at flash time — a typo there means it silently
              can't connect). A device also only reports "online" once it successfully reaches the broker, so a
              broker outage looks the same as the device being off.
            </p>
          </div>
          <div className={card}>
            <p className={label}>The Firmware page says WebSerial isn't available</p>
            <p className={p}>
              You're on Safari or Firefox, or on plain HTTP instead of HTTPS — WebSerial needs both Chrome/Edge and a
              secure context. Switch browsers, or use OTA instead if the device is already paired.
            </p>
          </div>
          <div className={card}>
            <p className={label}>A gravity-based profile isn't changing the setpoint</p>
            <p className={p}>
              Confirm a hydrometer is actually assigned to that fermenter (its Hydrometer tab) and has at least one
              reading — a gravity profile can't resolve anything until both are true, and deliberately leaves the
              setpoint untouched rather than guessing in the meantime.
            </p>
          </div>
          <div className={card}>
            <p className={label}>PID mode doesn't seem to be doing anything</p>
            <p className={p}>
              Its gains (Kp/Ki/Kd) default to zero, which means "off" — PID mode needs real tuned values before it
              controls anything. Thermostat mode is the safer starting point if you haven't tuned PID yet.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
