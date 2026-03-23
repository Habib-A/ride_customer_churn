function setText(el, text) {
  if (!el) return;
  el.textContent = text;
}

async function fetchJSON(url) {
  var resp = await fetch(url, { method: "GET" });
  if (!resp.ok) {
    throw new Error("Request failed: " + resp.status + " " + resp.statusText);
  }
  return await resp.json();
}

function chartBar(canvas, labels, values) {
  var ctx = canvas.getContext("2d");
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          data: values,
          backgroundColor: "rgba(45, 212, 191, 0.25)",
          borderColor: "rgba(45, 212, 191, 0.95)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: {
          ticks: { color: "rgba(232, 237, 245, 0.8)" },
          grid: { color: "rgba(94, 234, 212, 0.06)" },
        },
        y: {
          ticks: { color: "rgba(232, 237, 245, 0.8)" },
          grid: { color: "rgba(94, 234, 212, 0.06)" },
        },
      },
    },
  });
}

document.addEventListener("DOMContentLoaded", function () {
  var errorEl = document.getElementById("rfmsError");
  var rCanvas = document.getElementById("rScoreChart");
  var fCanvas = document.getElementById("fScoreChart");
  var mCanvas = document.getElementById("mScoreChart");
  var sCanvas = document.getElementById("sScoreChart");

  if (!rCanvas || !fCanvas || !mCanvas || !sCanvas) return;

  fetchJSON("/api/rfms/distributions")
    .then(function (data) {
      chartBar(rCanvas, data.R_score.labels, data.R_score.counts);
      chartBar(fCanvas, data.F_score.labels, data.F_score.counts);
      chartBar(mCanvas, data.M_score.labels, data.M_score.counts);
      chartBar(sCanvas, data.S_score.labels, data.S_score.counts);
    })
    .catch(function (err) {
      if (!errorEl) return;
      setText(errorEl, String(err && err.message ? err.message : err));
      errorEl.style.display = "block";
    });
});

