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
  var resultCard = document.getElementById("predictResult");
  var errorCard = document.getElementById("predictError");
  var churnLabel = document.getElementById("churnLabel");
  var churnProbability = document.getElementById("churnProbability");

  var submitBtn = form.querySelector('button[type="submit"]');
  var spinner = form.querySelector("#predictSpinner");

  var fields = {
    avg_rating_given: form.querySelector('input[name="avg_rating_given"]'),
    recency_days: form.querySelector('input[name="recency_days"]'),
    frequency: form.querySelector('input[name="frequency"]'),
    monetary: form.querySelector('input[name="monetary"]'),
    surge_exposure: form.querySelector('input[name="surge_exposure"]')
  };

  function disableSubmit(disabled) {
    if (submitBtn) submitBtn.disabled = disabled;
    if (spinner) setVisible(spinner, disabled);
  }

  function validatePayload(payload) {
    // Basic client-side sanity checks to make the API response clearer.
    if (payload.avg_rating_given < 1 || payload.avg_rating_given > 5) return "Avg rating must be between 1 and 5.";
    if (payload.recency_days < 0) return "Recency must be >= 0.";
    if (payload.frequency < 1) return "Frequency must be >= 1.";
    if (payload.monetary < 0) return "Monetary value must be >= 0.";
    if (payload.surge_exposure < 0 || payload.surge_exposure > 1) return "Surge exposure must be between 0 and 1.";
    return null;
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    setVisible(resultCard, false);
    setVisible(errorCard, false);
    setText(status, "");

    var payload = {
      avg_rating_given: Number(fields.avg_rating_given.value),
      recency_days: Number(fields.recency_days.value),
      frequency: Number(fields.frequency.value),
      monetary: Number(fields.monetary.value),
      surge_exposure: Number(fields.surge_exposure.value)
    };

    var validationError = validatePayload(payload);
    if (validationError) {
      setText(status, validationError);
      setVisible(errorCard, true);
      return;
    }

    disableSubmit(true);
    try {
      if (!resultCard || !status) return;

      var response = await fetch("/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        var text = await response.text();
        setText(status, "Prediction failed. Server returned: " + response.status);
        if (errorCard) setText(errorCard, text ? text : "Unknown server error.");
        setVisible(errorCard, true);
        return;
      }

      var data = await response.json();
      var probability = Number(data.probability);
      var isChurning = Number(data.is_churning);

      var probabilityPct = isFinite(probability) ? (probability * 100).toFixed(1) : "0.0";
      var label = isChurning === 1 ? "High churn risk" : "Lower churn risk";

      setText(churnLabel, label);
      setText(churnProbability, probabilityPct + "%");

      setVisible(errorCard, false);
      setVisible(resultCard, true);
      setText(status, "Prediction complete.");
    } catch (err) {
      setText(status, "Network error contacting the prediction API.");
      setVisible(errorCard, true);
      if (errorCard) setText(errorCard, String(err && err.message ? err.message : err));
    } finally {
      disableSubmit(false);
    }
  });
});

