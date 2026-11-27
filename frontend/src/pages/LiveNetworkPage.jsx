
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Cpu,
  MemoryStick,
  Wifi,
  ShieldCheck,
  Radio,
  Play,
  Square,
  AlertTriangle,
  Shield,
  Zap,
  Download,
  Gauge,
} from "lucide-react";

const WS_URL = import.meta.env.VITE_WS_URL || `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api/live-monitor/ws`;

const ALERT_COOLDOWN_MS = 60000;
const REQUIRED_CONSECUTIVE_SAMPLES = 3;

const CPU_THRESHOLD = 85;
const MEMORY_THRESHOLD = 90;
const TRAFFIC_ABSOLUTE_THRESHOLD = 500 * 1024; // 500 KB/s

export default function LiveNetworkPage() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState("");

  const socketRef = useRef(null);
  const countersRef = useRef({});
  const cooldownRef = useRef({});
  const baselineRef = useRef({
    receive: [],
    send: [],
  });
  const activeAlertsRef = useRef({});

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, []);

  function resetDetectionState() {
    countersRef.current = {};
    cooldownRef.current = {};
    baselineRef.current = {
      receive: [],
      send: [],
    };
    activeAlertsRef.current = {};
  }

  function addAlert({
    rule,
    severity,
    title,
    message,
  }) {
    const now = Date.now();
    const lastTriggered = cooldownRef.current[rule] || 0;

    if (now - lastTriggered < ALERT_COOLDOWN_MS) {
      return;
    }

    cooldownRef.current[rule] = now;

    const alert = {
      id: `${now}-${Math.random()}`,
      rule,
      severity,
      title,
      message,
      time: new Date().toLocaleTimeString(),
      timestamp: now,
    };

    setEvents((previous) =>
      [alert, ...previous].slice(0, 100)
    );
  }

  function updateCounter(rule, condition) {
    if (condition) {
      countersRef.current[rule] =
        (countersRef.current[rule] || 0) + 1;
    } else {
      countersRef.current[rule] = 0;
    }

    return (
      countersRef.current[rule] >=
      REQUIRED_CONSECUTIVE_SAMPLES
    );
  }

  function calculateBaseline(values) {
    if (!values.length) return 0;

    return (
      values.reduce((sum, value) => sum + value, 0) /
      values.length
    );
  }

  function updateTrafficBaseline(type, value) {
    const list = baselineRef.current[type];

    const baseline = calculateBaseline(list);

    // Keep a rolling history of the previous 20 samples.
    list.push(value);

    if (list.length > 20) {
      list.shift();
    }

    return baseline;
  }

  function analyzeSnapshot(data) {
    if (!data) return;

    const cpu = Number(data.cpu_percent || 0);
    const memory = Number(data.memory_percent || 0);

    const receiveRate = Number(
      data.network?.receive_rate_bytes_sec || 0
    );

    const sendRate = Number(
      data.network?.send_rate_bytes_sec || 0
    );

    const receiveBaseline = updateTrafficBaseline(
      "receive",
      receiveRate
    );

    const sendBaseline = updateTrafficBaseline(
      "send",
      sendRate
    );

    const cpuHigh = updateCounter(
      "cpu",
      cpu >= CPU_THRESHOLD
    );

    const memoryHigh = updateCounter(
      "memory",
      memory >= MEMORY_THRESHOLD
    );

    const receiveSpikeCondition =
      receiveRate >= TRAFFIC_ABSOLUTE_THRESHOLD &&
      (
        receiveBaseline <= 0 ||
        receiveRate >= receiveBaseline * 4
      );

    const sendSpikeCondition =
      sendRate >= TRAFFIC_ABSOLUTE_THRESHOLD &&
      (
        sendBaseline <= 0 ||
        sendRate >= sendBaseline * 4
      );

    const receiveSpike = updateCounter(
      "receive_spike",
      receiveSpikeCondition
    );

    const sendSpike = updateCounter(
      "send_spike",
      sendSpikeCondition
    );

    const abnormalCount = [
      cpuHigh,
      memoryHigh,
      receiveSpike,
      sendSpike,
    ].filter(Boolean).length;

    // CPU alert
    if (cpuHigh) {
      addAlert({
        rule: "high_cpu",
        severity: cpu >= 95 ? "HIGH" : "MEDIUM",
        title: "Elevated CPU Utilization",
        message: `CPU utilization remained elevated across multiple monitoring samples (${cpu.toFixed(
          1
        )}%). Investigate unusual resource activity.`,
      });
    }

    // Memory alert
    if (memoryHigh) {
      addAlert({
        rule: "high_memory",
        severity: memory >= 97 ? "HIGH" : "MEDIUM",
        title: "High Memory Utilization",
        message: `Memory usage remained above the configured threshold (${memory.toFixed(
          1
        )}%). Check for resource-intensive processes.`,
      });
    }

    // Incoming traffic alert
    if (receiveSpike) {
      addAlert({
        rule: "receive_spike",
        severity: "MEDIUM",
        title: "Incoming Traffic Anomaly",
        message: `Incoming network traffic exceeded the configured anomaly threshold (${formatBytes(
          receiveRate
        )}/s).`,
      });
    }

    // Outgoing traffic alert
    if (sendSpike) {
      addAlert({
        rule: "send_spike",
        severity: "MEDIUM",
        title: "Outgoing Traffic Anomaly",
        message: `Outgoing network traffic exceeded the configured anomaly threshold (${formatBytes(
          sendRate
        )}/s).`,
      });
    }

    // Combined alert
    if (abnormalCount >= 2) {
      addAlert({
        rule: "combined_anomaly",
        severity: "HIGH",
        title: "Combined System Anomaly",
        message:
          "Multiple monitored indicators are abnormal simultaneously. A system investigation is recommended.",
      });
    }

    // Track currently active rule conditions.
    activeAlertsRef.current = {
      cpu: cpuHigh,
      memory: memoryHigh,
      receive: receiveSpike,
      send: sendSpike,
    };
  }

  function startMonitoring() {
    if (
      socketRef.current &&
      (
        socketRef.current.readyState === WebSocket.OPEN ||
        socketRef.current.readyState === WebSocket.CONNECTING
      )
    ) {
      return;
    }

    setError("");
    setSnapshot(null);
    setEvents([]);
    setConnecting(true);
    setConnected(false);

    resetDetectionState();

    let socket;

    try {
      socket = new WebSocket(WS_URL);
      socketRef.current = socket;
    } catch {
      setError("Unable to initialize the monitoring connection.");
      setConnecting(false);
      return;
    }

    socket.onopen = () => {
      setConnected(true);
      setConnecting(false);
      setError("");
    };

    socket.onmessage = (message) => {
      try {
        const payload = JSON.parse(message.data);

        if (payload.type === "LIVE_SNAPSHOT") {
          const data = payload.data;

          setSnapshot(data);

          // Analyze actual incoming telemetry.
          analyzeSnapshot(data);

          // Display backend-provided events as well.
          if (payload.events?.length) {
            const backendEvents = payload.events.map(
              (event) => ({
                id: `${Date.now()}-${Math.random()}`,
                rule: event.type || "backend_event",
                severity: event.severity || "MEDIUM",
                title: event.title || ({
                  INTERNET_DISCONNECTED: "Internet Connectivity Lost",
                  INTERNET_RESTORED: "Internet Connectivity Restored",
                  CPU_USAGE: "High CPU Utilization",
                  MEMORY_USAGE: "High Memory Utilization",
                  TRAFFIC_SPIKE: "Network Traffic Spike",
                }[event.type] || "Backend Event"),
                message: event.message || "Monitoring event detected.",
                time: new Date().toLocaleTimeString(),
                timestamp: Date.now(),
              })
            );

            setEvents((previous) =>
              [...backendEvents, ...previous].slice(0, 100)
            );
          }
        }

        if (payload.type === "ERROR") {
          setError(
            payload.message || "Monitoring error received."
          );
        }
      } catch {
        setError("Unable to parse monitoring data.");
      }
    };

    socket.onerror = () => {
      setError(
        "Unable to connect. Check whether the FastAPI backend is running."
      );
      setConnecting(false);
    };

    socket.onclose = () => {
      setConnected(false);
      setConnecting(false);

      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }

  function stopMonitoring() {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    setConnected(false);
    setConnecting(false);
  }

  const network = snapshot?.network;

  // Transparent, heuristic health score based on the telemetry currently available.
  const healthScore = snapshot ? Math.max(0, Math.round(
    100 -
    (Number(snapshot.cpu_percent || 0) > 85 ? 20 : Number(snapshot.cpu_percent || 0) > 70 ? 10 : 0) -
    (Number(snapshot.memory_percent || 0) > 90 ? 20 : Number(snapshot.memory_percent || 0) > 75 ? 10 : 0) -
    (snapshot.internet?.connected === false ? 35 : 0) -
    (events.filter(e => e.severity === "HIGH" || e.severity === "CRITICAL").length * 10) -
    (events.filter(e => e.severity === "MEDIUM").length * 5)
  )) : null;

  const healthLabel = healthScore === null ? "Awaiting data" : healthScore >= 90 ? "Excellent" : healthScore >= 75 ? "Good" : healthScore >= 50 ? "Attention needed" : "Critical";

  function downloadReport() {
    if (!snapshot) return;
    const report = {
      project: "PROJECT MIRROR - Live Network Intelligence",
      generated_at: new Date().toISOString(),
      report_type: "Local system telemetry snapshot and rule-based events",
      health_score: healthScore,
      health_label: healthLabel,
      host: snapshot.hostname,
      cpu_percent: snapshot.cpu_percent,
      memory_percent: snapshot.memory_percent,
      internet: snapshot.internet,
      network: snapshot.network,
      interfaces: snapshot.interfaces,
      alerts: events,
      note: "Heuristic health score and alerts are indicators, not confirmation of malicious activity. This report contains telemetry collected from the monitoring host."
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `project-mirror-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const alertCounts = {
    total: events.length,
    high: events.filter(
      (event) =>
        event.severity === "HIGH" ||
        event.severity === "CRITICAL"
    ).length,
    medium: events.filter(
      (event) => event.severity === "MEDIUM"
    ).length,
  };

  return (
    <div className="space-y-6 pb-10">

      {/* HEADER */}
      <section className="rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-slate-900 to-emerald-950/30 p-6">

        <div className="flex items-center gap-3">
          <Radio className="w-6 h-6 text-emerald-400" />

          <span className="text-xs font-mono font-bold text-emerald-300">
            REAL-TIME SECURITY MONITOR
          </span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-black text-white mt-3">
          Live Network Intelligence
        </h1>

        <p className="text-sm text-slate-300 mt-2">
          Live system telemetry analysis and rule-based security anomaly monitoring.
        </p>

        <div className="flex flex-wrap gap-3 mt-5">

          {!connected ? (
            <button
              onClick={startMonitoring}
              disabled={connecting}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-500 text-black font-bold disabled:opacity-50"
            >
              <Play className="w-4 h-4" />
              {connecting
                ? "Connecting..."
                : "Start Monitoring"}
            </button>
          ) : (
            <button
              onClick={stopMonitoring}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-rose-500 text-white font-bold"
            >
              <Square className="w-4 h-4" />
              Stop Monitoring
            </button>
          )}

          <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-white/10">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                connected
                  ? "bg-emerald-400"
                  : connecting
                  ? "bg-amber-400"
                  : "bg-slate-500"
              }`}
            />

            <span className="text-sm text-white">
              {connected
                ? "LIVE"
                : connecting
                ? "CONNECTING"
                : "OFFLINE"}
            </span>
          </div>
        </div>
      </section>

      {/* ERROR */}
      {error && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-950/30 p-4 text-rose-300">
          {error}
        </div>
      )}

      {/* SECURITY ALERT SUMMARY */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

        <SummaryCard
          title="Total Alerts"
          value={alertCounts.total}
          icon={<Shield className="w-5 h-5" />}
        />

        <SummaryCard
          title="High Priority"
          value={alertCounts.high}
          icon={<AlertTriangle className="w-5 h-5" />}
          color="text-rose-400"
        />

        <SummaryCard
          title="Medium Priority"
          value={alertCounts.medium}
          icon={<Zap className="w-5 h-5" />}
          color="text-amber-400"
        />

      </div>

      {/* SYSTEM HEALTH SCORE + REPORT EXPORT */}
      <section className="rounded-3xl border border-cyan-500/25 bg-gradient-to-br from-slate-950/80 via-slate-900 to-cyan-950/30 p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
          <div className="flex items-center gap-4">
            <div className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border ${healthScore === null ? "border-white/10 text-slate-400" : healthScore >= 75 ? "border-emerald-400/30 text-emerald-300" : healthScore >= 50 ? "border-amber-400/30 text-amber-300" : "border-rose-400/30 text-rose-300"}`}>
              <div className="text-center"><div className="text-3xl font-black">{healthScore ?? "--"}</div><div className="text-[10px] uppercase tracking-wider">/100</div></div>
            </div>
            <div>
              <div className="flex items-center gap-2 text-cyan-300"><Gauge className="w-5 h-5"/><span className="text-xs font-bold tracking-widest">SYSTEM HEALTH INDEX</span></div>
              <h2 className="text-xl font-bold text-white mt-1">{healthLabel}</h2>
              <p className="text-sm text-slate-400 mt-1">A transparent heuristic score derived from live CPU, memory, connectivity and detected alert severity.</p>
            </div>
          </div>
          <button onClick={downloadReport} disabled={!snapshot} className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-3 font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed">
            <Download className="w-4 h-4"/> Export Monitoring Report
          </button>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800"><div className={`h-full rounded-full transition-all duration-500 ${healthScore >= 75 ? "bg-emerald-400" : healthScore >= 50 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${healthScore ?? 0}%` }}/></div>
        <p className="mt-3 text-xs text-slate-500">Score is a demonstration-oriented heuristic, not a certified security rating. Start monitoring to calculate it.</p>
      </section>

      {/* TELEMETRY METRICS */}
      <div className="grid md:grid-cols-2 xl:grid-cols-5 gap-4">

        <MetricCard
          title="CPU Usage"
          value={
            snapshot
              ? `${snapshot.cpu_percent}%`
              : "--"
          }
          icon={<Cpu className="w-5 h-5" />}
        />

        <MetricCard
          title="Memory Usage"
          value={
            snapshot
              ? `${snapshot.memory_percent}%`
              : "--"
          }
          icon={<MemoryStick className="w-5 h-5" />}
        />

        <MetricCard
          title="Incoming Traffic"
          value={
            network
              ? `${formatBytes(
                  network.receive_rate_bytes_sec
                )}/s`
              : "--"
          }
          icon={<Wifi className="w-5 h-5" />}
        />

        <MetricCard
          title="Outgoing Traffic"
          value={
            network
              ? `${formatBytes(
                  network.send_rate_bytes_sec
                )}/s`
              : "--"
          }
          icon={<Activity className="w-5 h-5" />}
        />

        <MetricCard
          title="Internet Connectivity"
          value={
            snapshot?.internet
              ? snapshot.internet.connected
                ? "CONNECTED"
                : "DISCONNECTED"
              : "--"
          }
          subtitle={
            snapshot?.internet?.connected
              ? `Latency: ${snapshot.internet.latency_ms ?? "--"} ms`
              : snapshot?.internet
              ? "Connectivity unavailable"
              : "Start monitoring"
          }
          icon={<Wifi className="w-5 h-5" />}
        />

      </div>

      {/* INTERNET CONNECTIVITY DETAILS */}
      <section className="rounded-3xl border border-white/10 bg-slate-950/40 p-5 space-y-3">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Radio className="w-5 h-5 text-emerald-400" />
          Internet Connectivity
        </h2>

        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-bold ${
              snapshot?.internet?.connected
                ? "border-emerald-500/30 bg-emerald-950/30 text-emerald-300"
                : snapshot?.internet
                ? "border-rose-500/30 bg-rose-950/30 text-rose-300"
                : "border-white/10 bg-slate-900/50 text-slate-400"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${
              snapshot?.internet?.connected
                ? "bg-emerald-400"
                : snapshot?.internet
                ? "bg-rose-400"
                : "bg-slate-500"
            }`} />
            {snapshot?.internet
              ? snapshot.internet.connected
                ? "Internet Available"
                : "Internet Unavailable"
              : "Awaiting telemetry"}
          </span>

          <span className="text-sm text-slate-400">
            Latency: {snapshot?.internet?.connected
              ? `${snapshot.internet.latency_ms ?? "--"} ms`
              : "--"}
          </span>
        </div>

        <div className="text-sm text-slate-400">
          Test endpoint: {snapshot?.internet?.endpoint || "Not available"}
        </div>

        <p className="text-xs text-slate-500">
          Connectivity is tested by attempting a TCP connection to a public endpoint. This does not measure all internet services or inspect network packets.
        </p>
      </section>

      {/* ACTIVE INTERFACES */}
      <section className="rounded-3xl border border-white/10 bg-slate-950/40 p-5 space-y-4">

        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Wifi className="w-5 h-5 text-emerald-400" />
          Active Interfaces
        </h2>

        {snapshot?.interfaces?.length ? (
          snapshot.interfaces.map((iface) => (
            <div
              key={iface.name}
              className="rounded-2xl border border-white/10 bg-slate-900/50 p-4"
            >

              <div className="flex items-center justify-between">
                <span className="font-bold text-white">
                  {iface.name}
                </span>

                <span
                  className={
                    iface.is_up
                      ? "text-emerald-300 text-xs"
                      : "text-rose-300 text-xs"
                  }
                >
                  {iface.is_up ? "UP" : "DOWN"}
                </span>
              </div>

              <div className="text-sm text-slate-400 mt-2">
                IPv4: {iface.ipv4}
              </div>

              <div className="text-sm text-slate-400">
                Link speed:{" "}
                {iface.speed_mbps > 0
                  ? `${iface.speed_mbps} Mbps`
                  : "Unknown"}
              </div>

            </div>
          ))
        ) : (
          <p className="text-sm text-slate-500">
            Start monitoring to view interface information.
          </p>
        )}

      </section>

      {/* LIVE SECURITY ALERT FEED */}
      <section className="rounded-3xl border border-white/10 bg-slate-950/40 p-5 space-y-4">

        <div className="flex items-center justify-between flex-wrap gap-3">

          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-amber-400" />
            Real-Time Security Alerts
          </h2>

          <button
            onClick={() => setEvents([])}
            className="text-xs text-slate-400 hover:text-white border border-white/10 px-3 py-2 rounded-lg"
          >
            Clear Alerts
          </button>

        </div>

        {events.length === 0 ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-5">

            <div className="flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />

              <span className="font-semibold text-emerald-300">
                No anomalies detected
              </span>
            </div>

            <p className="text-sm text-slate-400 mt-2">
              The rule-based monitoring engine is waiting for
              abnormal telemetry conditions.
            </p>

          </div>
        ) : (
          events.map((event) => (
            <AlertCard
              key={event.id}
              event={event}
            />
          ))
        )}

      </section>

      {/* DETECTION RULES */}
      <section className="rounded-3xl border border-white/10 bg-slate-950/40 p-5 space-y-4">

        <h2 className="text-lg font-bold text-white">
          Active Detection Rules
        </h2>

        <RuleRow
          title="High CPU Utilization"
          threshold={`${CPU_THRESHOLD}%`}
          description="Requires sustained high CPU usage across multiple samples."
        />

        <RuleRow
          title="High Memory Utilization"
          threshold={`${MEMORY_THRESHOLD}%`}
          description="Requires sustained high memory usage."
        />

        <RuleRow
          title="Traffic Anomaly"
          threshold="500 KB/s + baseline"
          description="Detects significant traffic increases using a threshold and recent traffic baseline."
        />

        <RuleRow
          title="Combined Anomaly"
          threshold="2 or more indicators"
          description="Elevates priority when multiple abnormal indicators occur simultaneously."
        />

      </section>

      {/* DISCLAIMER */}
      <section className="rounded-2xl border border-white/10 p-4 text-xs text-slate-400">

        These alerts are rule-based anomaly indicators generated
        from system telemetry. They do not confirm malicious
        activity, inspect network packets, identify attackers,
        or scan other devices.

      </section>

    </div>
  );
}

// ===============================
// ALERT CARD
// ===============================

function AlertCard({ event }) {
  const severityStyles = {
    LOW: "border-sky-500/30 bg-sky-950/20 text-sky-300",
    MEDIUM: "border-amber-500/30 bg-amber-950/20 text-amber-300",
    HIGH: "border-rose-500/30 bg-rose-950/20 text-rose-300",
    CRITICAL: "border-red-500/40 bg-red-950/30 text-red-300",
  };

  const style =
    severityStyles[event.severity] ||
    severityStyles.MEDIUM;

  return (
    <div
      className={`rounded-2xl border p-4 ${style}`}
    >

      <div className="flex items-start justify-between gap-3 flex-wrap">

        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5" />

          <span className="font-bold">
            {event.title || "Security Alert"}
          </span>
        </div>

        <div className="flex items-center gap-2">

          <span className="text-xs font-bold px-2 py-1 rounded-lg border border-current">
            {event.severity}
          </span>

          <span className="text-xs opacity-70">
            {event.time}
          </span>

        </div>

      </div>

      <p className="text-sm mt-3 text-slate-200">
        {event.message}
      </p>

    </div>
  );
}

// ===============================
// SUMMARY CARD
// ===============================

function SummaryCard({
  title,
  value,
  icon,
  color = "text-emerald-400",
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-slate-950/40 p-5">

      <div className="flex items-center justify-between">

        <span className="text-sm text-slate-400">
          {title}
        </span>

        <span className={color}>
          {icon}
        </span>

      </div>

      <div className="text-3xl font-black text-white mt-4">
        {value}
      </div>

    </div>
  );
}

// ===============================
// METRIC CARD
// ===============================

function MetricCard({ title, value, icon, subtitle }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-slate-950/40 p-5">

      <div className="flex items-center justify-between">

        <span className="text-sm text-slate-400">
          {title}
        </span>

        <span className="text-emerald-400">
          {icon}
        </span>

      </div>

      <div className="text-2xl sm:text-3xl font-black text-white mt-4">
        {value}
      </div>

      {subtitle && (
        <p className="text-xs text-slate-400 mt-2">{subtitle}</p>
      )}

    </div>
  );
}

// ===============================
// RULE ROW
// ===============================

function RuleRow({ title, threshold, description }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">

      <div className="flex items-center justify-between gap-3 flex-wrap">

        <span className="font-semibold text-white">
          {title}
        </span>

        <span className="text-xs font-mono text-emerald-300">
          {threshold}
        </span>

      </div>

      <p className="text-sm text-slate-400 mt-2">
        {description}
      </p>

    </div>
  );
}

// ===============================
// BYTE FORMATTER
// ===============================

function formatBytes(bytes) {
  if (!bytes || bytes < 1) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(bytes);
  let unit = 0;

  while (
    value >= 1024 &&
    unit < units.length - 1
  ) {
    value /= 1024;
    unit++;
  }

  return `${value.toFixed(2)} ${units[unit]}`;
}
