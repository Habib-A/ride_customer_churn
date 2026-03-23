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
        tooltip: { mode: "index", intersect: false },
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
  var errorEl = document.getElementById("segmentationError");
  var canvas = document.getElementById("segmentsChart");
  var tbody = document.getElementById("topRfmsTableBody");

  if (!canvas || !tbody) return;

  fetchJSON("/api/segmentation/summary")
    .then(function (data) {
      chartBar(
        canvas,
        data.segments.map(function (s) { return s.segment; }),
        data.segments.map(function (s) { return s.count; })
      );

      data.top_rfms.forEach(function (row) {
        var tr = document.createElement("tr");

        var td1 = document.createElement("td");
        td1.textContent = row.rfms;
        tr.appendChild(td1);

        var td2 = document.createElement("td");
        td2.textContent = String(row.count);
        tr.appendChild(td2);

        tbody.appendChild(tr);
      });
    })
    .catch(function (err) {
      if (!errorEl) return;
      setText(errorEl, String(err && err.message ? err.message : err));
      errorEl.style.display = "block";
    });
});

