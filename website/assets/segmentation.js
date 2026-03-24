function setText(el, text) {
  if (!el) return;
  el.textContent = text;
}

async function fetchJSON(path) {
  var url = typeof window.ridewiseUrl === "function" ? window.ridewiseUrl(path) : path;
  var resp = await fetch(url, { method: "GET" });
  if (!resp.ok) {
    var t = await resp.text();
    throw new Error(
      "Request failed: " + resp.status + " " + resp.statusText + (t ? " — " + t.slice(0, 120) : "")
    );
  }
  var raw = await resp.text();
  if (!raw) throw new Error("Empty response from " + url);
  return JSON.parse(raw);
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
        tooltip: { mode: "index", intersect: false },
      },
      scales: {
        x: {
          ticks: { color: "rgba(232, 237, 245, 0.8)", maxRotation: 45, minRotation: 0 },
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
  var errorEl = document.getElementById("segmentationError");
  var segCanvas = document.getElementById("segmentsChart");
  var fCanvas = document.getElementById("freqDistChart");
  var mCanvas = document.getElementById("monetaryDistChart");
  var rCanvas = document.getElementById("recencyDistChart");
  var sCanvas = document.getElementById("surgeDistChart");

  if (!segCanvas || !fCanvas || !mCanvas || !rCanvas || !sCanvas) return;

  Promise.all([fetchJSON("/api/segmentation/summary"), fetchJSON("/api/segmentation/feature_distributions")])
    .then(function (results) {
      var summary = results[0];
      var dist = results[1];

      chartBar(
        segCanvas,
        summary.segments.map(function (s) {
          return s.segment;
        }),
        summary.segments.map(function (s) {
          return s.count;
        })
      );

      chartBar(fCanvas, dist.frequency.labels, dist.frequency.counts);
      chartBar(mCanvas, dist.monetary.labels, dist.monetary.counts);
      chartBar(rCanvas, dist.recency_days.labels, dist.recency_days.counts);
      chartBar(sCanvas, dist.surge_exposure.labels, dist.surge_exposure.counts);
    })
    .catch(function (err) {
      if (!errorEl) return;
      setText(errorEl, String(err && err.message ? err.message : err));
      errorEl.style.display = "block";
    });
});
