function setText(el, text) {
  if (!el) return;
  el.textContent = text;
}

function setVisible(el, visible) {
  if (!el) return;
  el.style.display = visible ? "block" : "none";
}

document.addEventListener("DOMContentLoaded", function () {
  var form = document.getElementById("predictForm");
  if (!form) return;

  var status = document.getElementById("predictStatus");
  var resultWrap = document.getElementById("predictResult");
  var errorCard = document.getElementById("predictError");
  var verdict = document.getElementById("predictVerdict");
  var canvas = document.getElementById("churnGaugeChart");
  var gaugeChurnPct = document.getElementById("gaugeChurnPct");
  var gaugeNotChurnPct = document.getElementById("gaugeNotChurnPct");
  var featureInsights = document.getElementById("featureInsights");
  var globalFeaturesList = document.getElementById("globalFeaturesList");
  var localDriversList = document.getElementById("localDriversList");

  var submitBtn = form.querySelector('button[type="submit"]');
  var spinner = form.querySelector("#predictSpinner");

  var gaugeChart = null;

  var fields = {
    avg_rating_given: form.querySelector('input[name="avg_rating_given"]'),
    recency_days: form.querySelector('input[name="recency_days"]'),
    frequency: form.querySelector('input[name="frequency"]'),
    monetary: form.querySelector('input[name="monetary"]'),
    surge_exposure: form.querySelector('input[name="surge_exposure"]'),
    customer_segment: form.querySelector('select[name="customer_segment"]'),
  };

  function disableSubmit(disabled) {
    if (submitBtn) submitBtn.disabled = disabled;
    if (spinner) setVisible(spinner, disabled);
  }

  function validatePayload(payload) {
    if (payload.avg_rating_given < 1 || payload.avg_rating_given > 5) return "Avg rating must be between 1 and 5.";
    if (payload.recency_days < 0) return "Recency must be >= 0.";
    if (payload.frequency < 1) return "Frequency must be >= 1.";
    if (payload.monetary < 0) return "Monetary value must be >= 0.";
    if (payload.surge_exposure < 0 || payload.surge_exposure > 1) return "Surge exposure must be between 0 and 1.";
    return null;
  }

  function renderGauge(p) {
    if (!canvas || typeof Chart === "undefined") return;
    var churn = Math.min(1, Math.max(0, p));
    var rest = 1 - churn;

    var churnPctStr = (churn * 100).toFixed(1) + "%";
    var notStr = (rest * 100).toFixed(1) + "%";
    if (gaugeChurnPct) gaugeChurnPct.textContent = "Churn risk: " + churnPctStr;
    if (gaugeNotChurnPct) gaugeNotChurnPct.textContent = "Not churn: " + notStr;

    if (gaugeChart) {
      gaugeChart.destroy();
      gaugeChart = null;
    }

    var ctx = canvas.getContext("2d");
    gaugeChart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["Churn risk", "Not churn"],
        datasets: [
          {
            data: [churn, rest],
            backgroundColor: ["rgba(239, 68, 68, 0.92)", "rgba(34, 197, 94, 0.92)"],
            borderWidth: 0,
            hoverOffset: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        rotation: -90,
        circumference: 180,
        cutout: "68%",
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: "rgba(232,237,245,0.85)", padding: 16 },
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var label = ctx.label || "";
                var raw = ctx.raw;
                if (typeof raw !== "number") return label;
                return label + ": " + (raw * 100).toFixed(1) + "%";
              },
            },
          },
        },
      },
      plugins: [
        {
          id: "arcPercentLabels",
          afterDatasetsDraw: function (chart) {
            var meta = chart.getDatasetMeta(0);
            if (!meta || !meta.data) return;
            var c = chart.ctx;
            c.save();
            c.font = "600 13px DM Sans, system-ui, sans-serif";
            c.textAlign = "center";
            c.textBaseline = "middle";
            meta.data.forEach(function (arc, i) {
              var raw = chart.data.datasets[0].data[i];
              if (typeof raw !== "number" || raw < 0.02) return;
              var pos = arc.tooltipPosition();
              c.fillStyle = i === 0 ? "rgba(254, 242, 242, 0.95)" : "rgba(220, 252, 231, 0.95)";
              c.fillText((raw * 100).toFixed(1) + "%", pos.x, pos.y);
            });
            c.restore();
          },
        },
      ],
    });
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    setVisible(resultWrap, false);
    setVisible(errorCard, false);
    setText(status, "");
    if (verdict) {
      verdict.textContent = "";
      verdict.className = "predict-verdict";
    }
    if (gaugeChurnPct) gaugeChurnPct.textContent = "";
    if (gaugeNotChurnPct) gaugeNotChurnPct.textContent = "";
    if (featureInsights) featureInsights.style.display = "none";
    if (globalFeaturesList) globalFeaturesList.innerHTML = "";
    if (localDriversList) localDriversList.innerHTML = "";

    var payload = {
      avg_rating_given: Number(fields.avg_rating_given.value),
      recency_days: Number(fields.recency_days.value),
      frequency: Number(fields.frequency.value),
      monetary: Number(fields.monetary.value),
      surge_exposure: Number(fields.surge_exposure.value),
      customer_segment: fields.customer_segment ? fields.customer_segment.value : "Active Riders",
    };

    var validationError = validatePayload(payload);
    if (validationError) {
      setText(status, validationError);
      setVisible(errorCard, true);
      return;
    }

    disableSubmit(true);
    try {
      var predictUrl =
        typeof window.ridewiseUrl === "function" ? window.ridewiseUrl("/predict") : "/predict";
      var response = await fetch(predictUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      var rawBody = await response.text();

      if (!response.ok) {
        setText(status, "Prediction failed. Server returned: " + response.status);
        if (errorCard)
          setText(
            errorCard,
            rawBody ? rawBody.slice(0, 500) : "Empty body (wrong host? Use one Web Service or set API URL)."
          );
        setVisible(errorCard, true);
        return;
      }

      if (!rawBody) {
        setText(status, "Empty response from server.");
        if (errorCard)
          setText(
            errorCard,
            "No JSON body. If the UI is a Render Static Site, point it at the API: load https://YOUR-API.onrender.com/ridewise-env.js first."
          );
        setVisible(errorCard, true);
        return;
      }

      var data;
      try {
        data = JSON.parse(rawBody);
      } catch (parseErr) {
        setText(status, "Invalid JSON from server.");
        if (errorCard) setText(errorCard, rawBody.slice(0, 400));
        setVisible(errorCard, true);
        return;
      }
      var probability = Number(data.probability);
      var isChurning = Number(data.is_churning);

      if (!isFinite(probability)) probability = 0;

      if (verdict) {
        if (isChurning === 1) {
          verdict.textContent = "Churn risk — predicted positive class";
          verdict.className = "predict-verdict churn";
        } else {
          verdict.textContent = "Not churn — predicted negative class";
          verdict.className = "predict-verdict ok";
        }
      }

      renderGauge(probability);
      setVisible(errorCard, false);
      setVisible(resultWrap, true);
      setText(status, "Prediction complete.");

      if (featureInsights && globalFeaturesList && localDriversList) {
        var globalFeatures = Array.isArray(data.top_global_features) ? data.top_global_features : [];
        var localDrivers = Array.isArray(data.top_local_drivers) ? data.top_local_drivers : [];

        globalFeatures.forEach(function (g) {
          var li = document.createElement("li");
          li.textContent = g.feature + ": " + (Number(g.importance) * 100).toFixed(1) + "%";
          globalFeaturesList.appendChild(li);
        });
        localDrivers.forEach(function (d) {
          var li = document.createElement("li");
          var impact = Number(d.impact);
          var sign = impact >= 0 ? "+" : "-";
          li.textContent = d.feature + ": " + sign + Math.abs(impact).toFixed(3) + " impact";
          localDriversList.appendChild(li);
        });
        featureInsights.style.display = "block";
      }
    } catch (err) {
      setText(status, "Network error contacting the prediction API.");
      setVisible(errorCard, true);
      if (errorCard) setText(errorCard, String(err && err.message ? err.message : err));
    } finally {
      disableSubmit(false);
    }
  });
});
