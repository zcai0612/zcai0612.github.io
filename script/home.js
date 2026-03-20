document.addEventListener("DOMContentLoaded", () => {
  const portrait = document.querySelector("[data-avatar-swap]");

  if (portrait) {
    const togglePortrait = (active) => {
      portrait.classList.toggle("is-swapped", active);
    };

    portrait.addEventListener("mouseenter", () => togglePortrait(true));
    portrait.addEventListener("mouseleave", () => togglePortrait(false));
    portrait.addEventListener("focusin", () => togglePortrait(true));
    portrait.addEventListener("focusout", () => togglePortrait(false));
  }

  document.querySelectorAll("[data-hover-preview]").forEach((media) => {
    const video = media.querySelector("video");
    if (!video) {
      return;
    }

    const startPreview = () => {
      media.classList.add("is-previewing");
      video.currentTime = 0;
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }
    };

    const stopPreview = () => {
      media.classList.remove("is-previewing");
      video.pause();
      video.currentTime = 0;
    };

    media.addEventListener("mouseenter", startPreview);
    media.addEventListener("mouseleave", stopPreview);
    media.addEventListener("focusin", startPreview);
    media.addEventListener("focusout", stopPreview);
  });
});
