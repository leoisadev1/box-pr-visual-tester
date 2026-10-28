// Billing page behaviour: open the checkout modal and validate the payment form.
const overlay = document.getElementById("overlay");
const modal = document.getElementById("checkout");
const form = document.getElementById("pay");
const nameInput = document.getElementById("name");
const nameError = document.getElementById("name-error");

function openCheckout() {
  overlay.hidden = false;
  modal.hidden = false;
  document.body.classList.add("locked");
}

function closeCheckout() {
  overlay.hidden = true;
  modal.hidden = true;
  document.body.classList.remove("locked");
}

document.getElementById("upgrade").addEventListener("click", openCheckout);
document.getElementById("close").addEventListener("click", closeCheckout);
overlay.addEventListener("click", closeCheckout);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const missingName = nameInput.value.trim() === "";
  nameError.hidden = !missingName;
  nameInput.setAttribute("aria-invalid", String(missingName));
  if (missingName) return;
  form.dataset.state = "submitted";
});

// Lets the demo video set the page state without timers.
window.__checkout = { openCheckout, closeCheckout, submit: () => form.requestSubmit() };
