
import { useState } from "react";
import {
  ShieldCheck,
  Play,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Activity,
} from "lucide-react";

const scenarios = [
  {
    id: "credential",
    name: "Suspicious Login Activity",
    description:
      "A simulated account shows unusual authentication behaviour.",
    baseline: 82,
    result: 28,
    steps: [
      "Review the simulated authentication alert",
      "Require a credential reset in the sandbox",
      "Enable additional authentication checks",
    ],
  },
  {
    id: "service",
    name: "Exposed Service",
    description:
      "A simulated asset has a service that increases its exposure.",
    baseline: 74,
    result: 24,
    steps: [
      "Identify the exposed service in the twin",
      "Apply a simulated service restriction",
      "Recalculate asset exposure",
    ],
  },
  {
    id: "endpoint",
    name: "Endpoint Anomaly",
    description:
      "A simulated endpoint reports abnormal activity.",
    baseline: 91,
    result: 35,
    steps: [
      "Isolate the virtual endpoint",
      "Run a simulated health check",
      "Restore the endpoint to a monitored state",
    ],
  },
];

export default function ResponseSimulatorPage() {
  const [scenarioId, setScenarioId] = useState("credential");
  const [step, setStep] = useState(-1);
  const [complete, setComplete] = useState(false);

  const scenario =
    scenarios.find((s) => s.id === scenarioId) || scenarios[0];

  const reset = () => {
    setStep(-1);
    setComplete(false);
  };

  const run = () => {
    if (step < scenario.steps.length - 1) {
      setStep((current) => current + 1);
    } else {
      setComplete(true);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      <section className="card-rose p-6 rounded-3xl border border-emerald-500/20">
        <div className="flex items-center gap-2 text-emerald-300 text-xs font-mono font-bold">
          <ShieldCheck className="w-4 h-4" />
          SANDBOX INCIDENT RESPONSE LAB
        </div>

        <h1 className="text-2xl sm:text-3xl font-black text-white mt-2">
          Incident Response & Recovery Simulator
        </h1>

        <p className="text-sm text-slate-300 mt-2 max-w-3xl">
          Walk through a controlled response scenario, apply virtual
          containment and recovery steps, and compare simulated risk
          before and after the response. No action is performed on
          real systems.
        </p>
      </section>

      <section className="glass-panel rounded-3xl p-5 sm:p-6 border-white/10 space-y-4">
        <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
          Choose scenario
        </label>

        <div className="grid md:grid-cols-3 gap-3">
          {scenarios.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setScenarioId(s.id);
                reset();
              }}
              className={`text-left rounded-2xl p-4 border transition ${
                scenarioId === s.id
                  ? "border-emerald-400 bg-emerald-500/10"
                  : "border-white/10 bg-slate-900/60 hover:border-white/30"
              }`}
            >
              <div className="font-bold text-white">{s.name}</div>
              <p className="text-xs text-slate-400 mt-2">
                {s.description}
              </p>
            </button>
          ))}
        </div>
      </section>

      <div className="grid lg:grid-cols-3 gap-4">
        <section className="glass-panel rounded-3xl p-5 border-white/10 lg:col-span-2 space-y-4">
          <div className="flex items-center gap-2 text-amber-300 font-bold">
            <AlertTriangle className="w-4 h-4" />
            Response workflow
          </div>

          {scenario.steps.map((item, i) => (
            <div
              key={i}
              className={`flex gap-3 items-start p-4 rounded-2xl border ${
                i <= step
                  ? "border-emerald-500/40 bg-emerald-950/20"
                  : "border-white/10 bg-slate-950/30"
              }`}
            >
              <span
                className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${
                  i <= step
                    ? "bg-emerald-500 text-black"
                    : "bg-slate-800 text-slate-400"
                }`}
              >
                {i + 1}
              </span>

              <div>
                <div className="text-sm text-white font-semibold">
                  {item}
                </div>

                {i <= step && (
                  <div className="text-xs text-emerald-300 mt-1">
                    Simulated step completed
                  </div>
                )}
              </div>
            </div>
          ))}

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              onClick={run}
              disabled={complete}
              className="px-5 py-3 rounded-xl bg-emerald-500 text-slate-950 font-bold flex items-center gap-2 disabled:opacity-50"
            >
              <Play className="w-4 h-4" />
              {step < scenario.steps.length - 1
                ? "Execute next simulated step"
                : "Complete response"}
            </button>

            <button
              onClick={reset}
              className="px-5 py-3 rounded-xl border border-white/15 text-white flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Reset scenario
            </button>
          </div>

          {complete && (
            <div className="rounded-2xl p-4 border border-emerald-500/40 bg-emerald-950/30 text-emerald-200 flex gap-3">
              <CheckCircle2 className="w-5 h-5 shrink-0" />

              <div>
                <div className="font-bold">
                  Scenario response completed
                </div>

                <p className="text-xs mt-1">
                  The virtual response workflow has completed.
                  The displayed risk reduction is illustrative
                  and based on this scenario's preset model.
                </p>
              </div>
            </div>
          )}
        </section>

        <section className="glass-panel rounded-3xl p-5 border-white/10 space-y-4">
          <div className="flex items-center gap-2 text-purple-300 font-bold">
            <Activity className="w-4 h-4" />
            Simulation impact
          </div>

          <div className="rounded-2xl bg-slate-950/50 p-4">
            <div className="text-xs text-slate-400">
              Risk before response
            </div>

            <div className="text-4xl font-black text-rose-400">
              {scenario.baseline}
              <span className="text-sm text-slate-500">/100</span>
            </div>

            <div className="h-2 rounded-full bg-slate-800 mt-3 overflow-hidden">
              <div
                className="h-full bg-rose-500"
                style={{ width: `${scenario.baseline}%` }}
              />
            </div>
          </div>

          <div className="rounded-2xl bg-slate-950/50 p-4">
            <div className="text-xs text-slate-400">
              Risk after response
            </div>

            <div
              className={`text-4xl font-black ${
                complete
                  ? "text-emerald-400"
                  : "text-slate-500"
              }`}
            >
              {complete ? scenario.result : "—"}
              <span className="text-sm text-slate-500">/100</span>
            </div>

            <div className="h-2 rounded-full bg-slate-800 mt-3 overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{
                  width: complete
                    ? `${scenario.result}%`
                    : "0%",
                }}
              />
            </div>
          </div>

          {complete && (
            <div className="text-sm text-emerald-300 font-semibold">
              Illustrative risk reduction:{" "}
              {scenario.baseline - scenario.result} points (
              {Math.round(
                ((scenario.baseline - scenario.result) /
                  scenario.baseline) *
                  100
              )}
              %)
            </div>
          )}

          <p className="text-[11px] text-slate-500">
            Scenario values are demo-model outputs, not
            real-world risk measurements.
          </p>
        </section>
      </div>
    </div>
  );
}
