// Login page logic.

import { api, ApiError } from "../api.js";
import { hasValidSession } from "../auth.js";

// If they're already signed in, jump straight to the dashboard.
if (hasValidSession()) {
  location.replace("dashboard.html");
}

const form     = document.getElementById("login-form");
const password = document.getElementById("password");
const button   = document.getElementById("login-button");
const errorEl  = document.getElementById("login-error");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.style.display = "none";
  errorEl.textContent = "";
  button.disabled = true;
  button.textContent = "Signing in…";

  try {
    await api("login", { password: password.value });
    location.replace("dashboard.html");
  } catch (err) {
    if (err instanceof ApiError && err.code === "UNAUTHORIZED") {
      errorEl.textContent = "Incorrect password.";
      errorEl.style.display = "block";
      password.select();
    } else if (err instanceof ApiError && err.code === "QUOTA_EXCEEDED") {
      errorEl.textContent = "Too many failed attempts today. Try again tomorrow.";
      errorEl.style.display = "block";
    } else {
      // Network/internal — toast already shown by api.js. Show generic fallback.
      errorEl.textContent = "Sign-in failed. Try again.";
      errorEl.style.display = "block";
    }
  } finally {
    button.disabled = false;
    button.textContent = "Sign in";
  }
});
