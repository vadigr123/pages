(function () {
  "use strict";

  const ONBOARDING_FLAG = "lofi-onboarding-dismissed";

  function initOnboarding() {
    try {
      const hasSeenOnboarding = localStorage.getItem(ONBOARDING_FLAG);
      if (!hasSeenOnboarding) {
        const overlay = document.getElementById("onboarding-overlay");
        if (overlay) {
          overlay.style.display = "flex";
        }
      }
    } catch (e) {
      console.debug("Onboarding localStorage check failed:", e);
    }
  }

  window.dismissOnboarding = function () {
    try {
      localStorage.setItem(ONBOARDING_FLAG, "true");
    } catch (e) {
      console.debug("Onboarding localStorage set failed:", e);
    }
    const overlay = document.getElementById("onboarding-overlay");
    if (overlay) {
      overlay.style.display = "none";
    }
  };

  window.OnboardingModule = {
    init: initOnboarding,
    dismiss: function () {
      window.dismissOnboarding();
    },
  };

  // Auto-initialize if DOM is already ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initOnboarding);
  } else {
    setTimeout(initOnboarding, 0);
  }
})();
