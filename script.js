const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.querySelector(".site-nav");
const navLinks = [...document.querySelectorAll('.site-nav a[href^="#"]')];
const sections = navLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);
const consultForm = document.getElementById("consult-form");
const formNote = document.getElementById("form-note");
const yearNode = document.getElementById("year");
const revealNodes = [...document.querySelectorAll(".reveal")];

if (yearNode) {
  yearNode.textContent = String(new Date().getFullYear());
}

function closeNav() {
  if (!siteNav || !navToggle) return;
  siteNav.classList.remove("open");
  navToggle.setAttribute("aria-expanded", "false");
  document.body.classList.remove("nav-open");
}

if (navToggle && siteNav) {
  navToggle.addEventListener("click", () => {
    const isOpen = siteNav.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
    document.body.classList.toggle("nav-open", isOpen);
  });
}

document.addEventListener("click", (event) => {
  if (!siteNav || !navToggle) return;
  if (!siteNav.classList.contains("open")) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (siteNav.contains(target) || navToggle.contains(target)) return;
  closeNav();
});

navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    closeNav();
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeNav();
  }
});

if (sections.length) {
  const sectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((link) => {
          const isActive = link.getAttribute("href") === `#${entry.target.id}`;
          link.classList.toggle("active", isActive);
        });
      });
    },
    {
      rootMargin: "-35% 0px -45% 0px",
      threshold: 0,
    },
  );

  sections.forEach((section) => sectionObserver.observe(section));
}

if (revealNodes.length) {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      });
    },
    {
      threshold: 0.12,
    },
  );

  revealNodes.forEach((node) => revealObserver.observe(node));
}

if (consultForm && formNote) {
  consultForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(consultForm);
    const name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const message = String(formData.get("message") || "").trim();

    formNote.textContent = "Sending your consultation request...";
    formNote.classList.remove("success");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, email, message }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "Unable to send your consultation request.");
      }

      formNote.textContent = name
        ? `Thanks, ${name}. Your consultation request has been sent to nishima2210@gmail.com.`
        : "Your consultation request has been sent to nishima2210@gmail.com.";
      formNote.classList.add("success");
      consultForm.reset();
    } catch (error) {
      formNote.textContent =
        error instanceof Error
          ? error.message
          : "Unable to send your consultation request right now.";
      formNote.classList.remove("success");
    }
  });
}
