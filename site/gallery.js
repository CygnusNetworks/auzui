// Screenshot gallery (shared by the English and German page): topic tabs →
// one large stage image + a thumbnail strip, a lightbox on click, and one
// light/dark switch for all images (`NAME.png` ↔ `NAME-dark.png`, defaulting
// to the visitor's OS theme). Without JS the topics stay captioned grids.
// The asset prefix comes from data-base on #gallery ("./" or "../").
(function () {
  var gallery = document.getElementById("gallery");
  if (!gallery) return;
  var base = (gallery.getAttribute("data-base") || "./") + "assets/screenshots/";
  var topics = Array.prototype.slice.call(gallery.querySelectorAll(".topic"));
  var tabsEl = gallery.querySelector(".topic-tabs");
  var stage = gallery.querySelector(".stage");
  var stageImg = stage.querySelector(".stage-img");
  var stageTitle = stage.querySelector(".stage-title");
  var stageDesc = stage.querySelector(".stage-desc");
  var stageCount = stage.querySelector(".stage-count");
  var box = document.querySelector(".lightbox");
  var boxImg = box && box.querySelector("img");
  var boxCaption = box && box.querySelector(".lightbox-caption");
  var themeBtns = gallery.querySelectorAll("[data-theme-btn]");
  var theme = "light";
  var current = { topic: 0, shot: 0 };

  function src(name) {
    return base + name + (theme === "dark" ? "-dark" : "") + ".png";
  }
  function figures(t) {
    return Array.prototype.slice.call(topics[t].querySelectorAll("figure"));
  }
  function parts(fig) {
    var cap = fig.querySelector("figcaption");
    var title = cap.querySelector("strong");
    var desc = cap.textContent.replace(title ? title.textContent : "", "").trim();
    return {
      name: fig.getAttribute("data-shot"),
      title: title ? title.textContent : "",
      desc: desc,
      alt: fig.querySelector("img").getAttribute("alt") || "",
    };
  }

  function show(t, s) {
    var figs = figures(t);
    s = (s + figs.length) % figs.length;
    current = { topic: t, shot: s };
    topics.forEach(function (el, i) { el.classList.toggle("is-active", i === t); });
    tabsEl.querySelectorAll("[role=tab]").forEach(function (b, i) {
      b.setAttribute("aria-selected", i === t ? "true" : "false");
      b.tabIndex = i === t ? 0 : -1;
    });
    figs.forEach(function (f, i) {
      f.classList.toggle("is-current", i === s);
      f.setAttribute("aria-current", i === s ? "true" : "false");
    });
    var p = parts(figs[s]);
    stageImg.src = src(p.name);
    stageImg.alt = p.alt;
    stageTitle.textContent = p.title;
    stageDesc.textContent = p.desc;
    stageCount.textContent = (s + 1) + " / " + figs.length;
    if (box && box.open) fillBox();
  }
  function fillBox() {
    var p = parts(figures(current.topic)[current.shot]);
    boxImg.src = src(p.name);
    boxImg.alt = p.alt;
    boxCaption.textContent = p.title + " — " + p.desc;
  }
  function step(d) { show(current.topic, current.shot + d); }

  function applyTheme(next) {
    theme = next;
    gallery.querySelectorAll("figure[data-shot] img").forEach(function (img) {
      img.src = src(img.closest("figure").getAttribute("data-shot"));
    });
    themeBtns.forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-theme-btn") === theme);
    });
    show(current.topic, current.shot);
  }

  topics.forEach(function (el, i) {
    var b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.id = "topic-tab-" + el.getAttribute("data-topic");
    b.innerHTML = el.getAttribute("data-label") +
      ' <span class="topic-count">' + figures(i).length + "</span>";
    b.addEventListener("click", function () { show(i, 0); });
    tabsEl.appendChild(b);
    el.setAttribute("role", "tabpanel");
    el.setAttribute("aria-labelledby", b.id);
    figures(i).forEach(function (fig, s) {
      fig.tabIndex = 0;
      fig.addEventListener("click", function () { show(i, s); });
      fig.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(i, s); }
      });
    });
  });
  tabsEl.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    var t = (current.topic + (e.key === "ArrowRight" ? 1 : -1) + topics.length) % topics.length;
    show(t, 0);
    tabsEl.querySelectorAll("[role=tab]")[t].focus();
  });

  stage.querySelector(".stage-prev").addEventListener("click", function () { step(-1); });
  stage.querySelector(".stage-next").addEventListener("click", function () { step(1); });
  stage.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });
  stage.querySelector(".stage-frame").addEventListener("click", function () {
    if (!box || typeof box.showModal !== "function") {
      window.open(stageImg.src, "_blank", "noopener");
      return;
    }
    fillBox();
    box.showModal();
  });
  if (box) {
    box.querySelector(".lightbox-close").addEventListener("click", function () { box.close(); });
    box.querySelector(".lightbox-prev").addEventListener("click", function () { step(-1); });
    box.querySelector(".lightbox-next").addEventListener("click", function () { step(1); });
    box.addEventListener("click", function (e) { if (e.target === box) box.close(); });
    box.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    });
  }
  themeBtns.forEach(function (b) {
    b.addEventListener("click", function () { applyTheme(b.getAttribute("data-theme-btn")); });
  });

  gallery.classList.add("is-enhanced");
  stage.hidden = false;
  var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  // Deep link: #screenshots-docker opens that topic.
  function topicFromHash() {
    if (location.hash.indexOf("#screenshots-") !== 0) return -1;
    var key = location.hash.slice("#screenshots-".length);
    return topics.findIndex(function (el) { return el.getAttribute("data-topic") === key; });
  }
  window.addEventListener("hashchange", function () {
    var t = topicFromHash();
    if (t < 0) return;
    show(t, 0);
    document.getElementById("screenshots").scrollIntoView({ behavior: "smooth" });
  });
  var start = topicFromHash();
  current = { topic: start < 0 ? 0 : start, shot: 0 };
  applyTheme(prefersDark ? "dark" : "light");
  if (start >= 0) document.getElementById("screenshots").scrollIntoView();
})();
