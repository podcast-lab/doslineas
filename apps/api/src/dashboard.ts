export const DASHBOARD = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>doslineas · sessions</title>
<style>
  :root {
    color-scheme: light dark;
    --ink: #16181d; --dim: #666e7a; --line: #d8dce3; --card: #ffffff; --ground: #f4f5f7;
    --waiting: #8a919c; --running: #1f6feb; --delivered: #1a7f37; --failed: #cf222e;
  }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #e6e8ec; --dim: #9aa2ae; --line: #2b3038; --card: #171a1f; --ground: #0f1115; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 2rem 1.5rem; background: var(--ground); color: var(--ink);
         font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 62rem; margin: 0 auto; }
  h1 { font-size: 1.25rem; margin: 0 0 .25rem; }
  h2 { font-size: .95rem; margin: 2rem 0 .75rem; color: var(--dim); font-weight: 600; }
  .where { color: var(--dim); font-size: .85rem; margin-bottom: 1.5rem; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px;
          padding: 1rem 1.1rem; margin-bottom: .75rem; }
  .head { display: flex; align-items: baseline; gap: .75rem; flex-wrap: wrap; }
  .name { font-weight: 600; }
  .state { font-size: .75rem; text-transform: uppercase; letter-spacing: .06em; font-weight: 700; }
  .state.waiting { color: var(--waiting); } .state.running { color: var(--running); }
  .state.delivered { color: var(--delivered); } .state.failed { color: var(--failed); }
  .when { color: var(--dim); font-size: .8rem; margin-left: auto; }
  .steps { display: flex; gap: .4rem; flex-wrap: wrap; margin: .8rem 0 0; padding: 0; list-style: none; }
  .step { border: 1px solid var(--line); border-radius: 999px; padding: .15rem .6rem; font-size: .78rem; }
  .step.done { border-color: var(--delivered); color: var(--delivered); }
  .step.skipped { color: var(--dim); }
  .step.leased { border-color: var(--running); color: var(--running); }
  .step.failed { border-color: var(--failed); color: var(--failed); }
  .note { color: var(--dim); font-size: .82rem; margin-top: .6rem; white-space: pre-wrap; }
  .actions { display: flex; gap: .5rem; margin-top: .9rem; }
  button { font: inherit; font-size: .82rem; padding: .3rem .8rem; border-radius: 7px;
           border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
  button:hover { border-color: var(--dim); }
  button.danger { border-color: var(--failed); color: var(--failed); }
  .alert { display: flex; gap: .75rem; align-items: baseline; }
  .kind { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); min-width: 9rem; }
  .empty { color: var(--dim); font-size: .9rem; }
</style>
</head>
<body>
<main>
  <h1>doslineas · <span id="studio">…</span></h1>
  <p class="where" id="where"></p>
  <h2>Alerts</h2>
  <div id="alerts"></div>
  <h2>Sessions</h2>
  <div id="sessions"></div>
</main>
<script>
const escape = (value) => String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const when = (at) => at === null ? "" : new Date(at).toLocaleString();

async function call(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || response.statusText);
  return body;
}

function stepChip(step) {
  const title = step.note ? escape(step.note) : "";
  const attempts = step.attempts > 1 ? " ×" + step.attempts : "";
  return '<li class="step ' + step.state + '" title="' + title + '">' + escape(step.step) + attempts + "</li>";
}

function sessionCard(session) {
  const failed = session.steps.filter((step) => step.state === "failed");
  const notes = failed.map((step) => step.step + ": " + step.note).join("\n");
  const confirmable = session.state === "delivered";

  return '<div class="card">' +
    '<div class="head"><span class="name">' + escape(session.session) + "</span>" +
    '<span class="state ' + session.state + '">' + session.state + "</span>" +
    '<span class="when">' + when(session.finishedAt ?? session.startedAt) + "</span></div>" +
    '<ul class="steps">' + session.steps.map(stepChip).join("") + "</ul>" +
    (notes ? '<p class="note">' + escape(notes) + "</p>" : "") +
    '<div class="actions">' +
    '<button data-retry="' + escape(session.session) + '">Retry what failed</button>' +
    (confirmable ? '<button class="danger" data-confirm="' + escape(session.session) + '">Confirm delivery and drop the raw</button>' : "") +
    "</div></div>";
}

function alertCard(alert) {
  return '<div class="card alert">' +
    '<span class="kind">' + escape(alert.kind) + "</span>" +
    "<span>" + escape(alert.message) + "</span>" +
    '<button data-ack="' + alert.id + '">Seen</button>' +
    "</div>";
}

async function refresh() {
  const data = await call("/api/overview");
  document.getElementById("studio").textContent = data.studio;
  document.getElementById("where").textContent = "watching " + data.sessionsRoot + " · delivering to " + data.deliveryRoot;
  document.getElementById("alerts").innerHTML =
    data.alerts.length === 0 ? '<p class="empty">Nothing to look at.</p>' : data.alerts.map(alertCard).join("");
  document.getElementById("sessions").innerHTML =
    data.sessions.length === 0 ? '<p class="empty">No session has arrived yet.</p>' : data.sessions.map(sessionCard).join("");
}

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;

  try {
    if (target.dataset.retry) {
      await call("/api/sessions/" + encodeURIComponent(target.dataset.retry) + "/retry", { method: "POST" });
    } else if (target.dataset.confirm) {
      const name = target.dataset.confirm;
      const preview = await call("/api/sessions/" + encodeURIComponent(name) + "/confirm?dryRun=true", { method: "POST" });
      const size = (preview.freedBytes / 1e9).toFixed(1);
      if (!window.confirm("Delete " + preview.removedFiles.length + " raw files of " + name + " (" + size + " GB)?\n\nThey are delivered to " + preview.target + ".")) return;
      await call("/api/sessions/" + encodeURIComponent(name) + "/confirm", { method: "POST" });
    } else if (target.dataset.ack) {
      await call("/api/alerts/" + target.dataset.ack + "/ack", { method: "POST" });
    } else {
      return;
    }
    await refresh();
  } catch (failure) {
    window.alert(failure.message);
  }
});

refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>
`;
