/* e621 tag extractor — lofi.os */
"use strict";

  const INITIAL_CHARACTERS = {};
  const DEFAULT_BANNED_SUFFIXES = [];

  let currentBannedList = [];
  let savedCharacters = {};
  let currentMode = "solo";
  let editingCharId = null;
  let enabledCategories = {
    general: true,
    artists: true,
    species: true,
    meta: true,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function showModal(id) {
    const el = $(id);
    if (el) el.classList.add("visible");
  }

  function hideModal(id) {
    const el = $(id);
    if (el) el.classList.remove("visible");
  }

  window.addEventListener("DOMContentLoaded", function () {
    loadSettings();
    loadCharacters();
    updatePresetDropdown("solo");
    setupImagePreviewListeners();
    updateCharacterDisplay();
    setupMikusDropzone();
    $("urlInput").addEventListener("keypress", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        window.fetchTags();
      }
    });
    document.addEventListener("dragover", function (e) {
      e.preventDefault();
    });
    document.addEventListener("drop", function (e) {
      e.preventDefault();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeImageZoom();
    });
  });

  function setupImagePreviewListeners() {
    const urlInput = $("newCharImgUrl");
    const fileInput = $("newCharFile");
    const dropzone = $("newCharDropzone");
    const fileNameEl = $("newCharFileName");
    const previewBox = $("formImgPreview");
    const previewImg = previewBox.querySelector("img");

    function updatePreview(src) {
      if (src) {
        previewImg.src = src;
        previewImg.onerror = function () {
          previewBox.classList.remove("visible");
        };
        previewImg.onload = function () {
          previewBox.classList.add("visible");
        };
      } else {
        previewBox.classList.remove("visible");
        previewImg.src = "";
      }
    }

    urlInput.addEventListener("input", function (e) {
      if (e.target.value) {
        fileInput.value = "";
        if (fileNameEl) fileNameEl.textContent = "";
        updatePreview(e.target.value);
      } else updatePreview("");
    });

    fileInput.addEventListener("change", function (e) {
      if (e.target.files && e.target.files[0]) {
        urlInput.value = "";
        if (fileNameEl) fileNameEl.textContent = e.target.files[0].name;
        const reader = new FileReader();
        reader.onload = function (ev) {
          updatePreview(ev.target.result);
        };
        reader.readAsDataURL(e.target.files[0]);
      }
    });

    if (dropzone) {
      dropzone.addEventListener("click", function () {
        fileInput.click();
      });
      ["dragenter", "dragover"].forEach(function (ev) {
        dropzone.addEventListener(ev, function (e) {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.add("drag");
        });
      });
      ["dragleave", "drop"].forEach(function (ev) {
        dropzone.addEventListener(ev, function (e) {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.remove("drag");
        });
      });
      dropzone.addEventListener("drop", function (e) {
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) {
          fileInput.files = e.dataTransfer.files;
          if (fileNameEl) fileNameEl.textContent = f.name;
          fileInput.dispatchEvent(new Event("change"));
        }
      });
    }
  }

  function loadCharacters() {
    const saved = localStorage.getItem("e621_pro_characters");
    if (saved) {
      try {
        savedCharacters = JSON.parse(saved);
      } catch (e) {
        savedCharacters = {};
        saveCharacters();
      }
    } else {
      savedCharacters = {};
      saveCharacters();
    }
  }

  function saveCharacters() {
    try {
      localStorage.setItem("e621_pro_characters", JSON.stringify(savedCharacters));
    } catch (e) {
      if (e.name === "QuotaExceededError") {
        showToast("Storage limit exceeded! Try smaller images.", true);
      } else {
        showToast("Storage error: " + e.message, true);
      }
    }
  }

  window.resetCharactersToDefault = function () {
    const btn = document.querySelector('button[onclick="resetCharactersToDefault()"]');
    if (btn && btn.dataset.confirm !== "true") {
      btn.dataset.confirm = "true";
      const originalText = btn.textContent;
      btn.textContent = "Are you SURE?";
      setTimeout(function () {
        if (document.body.contains(btn) && btn.dataset.confirm === "true") {
          btn.dataset.confirm = "false";
          btn.textContent = originalText;
        }
      }, 3000);
      return;
    }
    savedCharacters = JSON.parse(JSON.stringify(INITIAL_CHARACTERS));
    saveCharacters();
    renderCharacterList();
    updatePresetDropdown(currentMode);
    updateCharacterDisplay();
    showToast("All characters cleared.");
    if (btn) {
      btn.dataset.confirm = "false";
      btn.textContent = "Reset all";
    }
  };

  function updatePresetDropdown(mode) {
    currentMode = mode;
    $("modeIndicator").textContent = mode === "duo" ? "Duo" : "Solo";
    const select = $("characterSelect");
    select.innerHTML = '<option value="">-- No Character (Tags Only) --</option>';
    const keys = Object.keys(savedCharacters).filter(function (key) {
      return (savedCharacters[key].type || "solo") === mode;
    });
    if (keys.length === 0) {
      const opt = document.createElement("option");
      opt.disabled = true;
      opt.textContent = "No " + mode + " presets found.";
      select.appendChild(opt);
      return;
    }
    keys.forEach(function (key) {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = savedCharacters[key].name;
      select.appendChild(opt);
    });
    if (select.options.length > 1) select.selectedIndex = 1;
  }

  function compressImage(file, maxWidth, quality) {
    maxWidth = maxWidth || 150;
    quality = quality || 0.6;
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = function (event) {
        const img = new Image();
        img.src = event.target.result;
        img.onload = function () {
          const elem = document.createElement("canvas");
          let width = img.width;
          let height = img.height;
          if (width > maxWidth) {
            height *= maxWidth / width;
            width = maxWidth;
          }
          elem.width = width;
          elem.height = height;
          elem.getContext("2d").drawImage(img, 0, 0, width, height);
          resolve(elem.toDataURL("image/jpeg", quality));
        };
        img.onerror = reject;
      };
      reader.onerror = reject;
    });
  }

  window.saveCharacter = async function () {
    const name = $("newCharName").value.trim();
    const tags = $("newCharTags").value.trim();
    const type = $("newCharType").value;
    const refUrl = $("newCharUrl").value.trim();
    let imgSrc = $("newCharImgUrl").value.trim();
    const fileInput = $("newCharFile");

    if (!name || !tags) {
      showToast("Please fill in Name and Prompt!", true);
      return;
    }

    if (fileInput.files && fileInput.files[0]) {
      try {
        imgSrc = await compressImage(fileInput.files[0], 150, 0.6);
      } catch (e) {
        showToast("Error processing image", true);
        return;
      }
    }

    if (editingCharId && !imgSrc && !fileInput.files.length && !$("newCharImgUrl").value) {
      imgSrc = savedCharacters[editingCharId].image || "";
    }

    const charData = { name, tags, type, url: refUrl, image: imgSrc };
    let action = "added";
    if (editingCharId) {
      savedCharacters[editingCharId] = charData;
      action = "updated";
    } else {
      savedCharacters["char_" + Date.now()] = charData;
    }

    saveCharacters();
    cancelEdit();
    renderCharacterList();
    if (type === currentMode) {
      updatePresetDropdown(currentMode);
      updateCharacterDisplay();
    }
    showToast("Character " + action + "!");
  };

  window.editCharacter = function (id) {
    const char = savedCharacters[id];
    if (!char) return;
    $("newCharName").value = char.name;
    $("newCharTags").value = char.tags;
    $("newCharType").value = char.type || "solo";
    $("newCharUrl").value = char.url || "";
    $("newCharImgUrl").value = "";
    $("newCharFile").value = "";
    const previewBox = $("formImgPreview");
    const previewImg = previewBox.querySelector("img");
    if (char.image) {
      if (!char.image.startsWith("data:")) $("newCharImgUrl").value = char.image;
      previewImg.src = char.image;
      previewBox.classList.add("visible");
    } else previewBox.classList.remove("visible");
    editingCharId = id;
    $("formTitle").textContent = "Edit Character";
    $("saveCharBtn").textContent = "Update Character";
    $("cancelEditBtn").classList.remove("hidden");
    $("charFormContainer").scrollIntoView({ behavior: "smooth" });
  };

  window.cancelEdit = function () {
    $("newCharName").value = "";
    $("newCharTags").value = "";
    $("newCharType").value = "solo";
    $("newCharUrl").value = "";
    $("newCharImgUrl").value = "";
    $("newCharFile").value = "";
    $("formImgPreview").classList.remove("visible");
    editingCharId = null;
    $("formTitle").textContent = "Add Character";
    $("saveCharBtn").textContent = "Save";
    $("cancelEditBtn").classList.add("hidden");
  };

  window.deleteCharacter = function (id, btn) {
    if (editingCharId === id) cancelEdit();
    if (btn.dataset.confirm === "true") {
      delete savedCharacters[id];
      saveCharacters();
      renderCharacterList();
      updatePresetDropdown(currentMode);
      updateCharacterDisplay();
      showToast("Character deleted.");
    } else {
      btn.dataset.confirm = "true";
      const originalHTML = btn.innerHTML;
      btn.textContent = "Sure?";
      setTimeout(function () {
        if (document.body.contains(btn)) {
          btn.dataset.confirm = "false";
          btn.innerHTML = originalHTML;
        }
      }, 3000);
    }
  };

  window.openCharManager = function () {
    renderCharacterList();
    cancelEdit();
    showModal("charModal");
  };

  window.closeCharManager = function () {
    hideModal("charModal");
  };

  function renderCharacterList() {
    const listEl = $("customCharList");
    listEl.innerHTML = "";
    const keys = Object.keys(savedCharacters);
    if (keys.length === 0) {
      listEl.innerHTML = '<p class="e621-tags-hint">No characters saved.</p>';
      return;
    }
    keys.forEach(function (key) {
      const char = savedCharacters[key];
      const item = document.createElement("div");
      item.className = "e621-char-list-item";
      const thumb = char.image
        ? '<img src="' + char.image + '" class="char-thumb" alt="">'
        : '<div class="char-thumb"></div>';
      item.innerHTML =
        '<div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1">' +
        thumb +
        "<div><strong>" +
        char.name +
        "</strong><br><small>" +
        char.tags.slice(0, 60) +
        "</small></div></div>" +
        '<div style="display:flex;gap:4px">' +
        '<button type="button" class="os-btn" onclick="editCharacter(\'' +
        key +
        "')\">Edit</button>" +
        '<button type="button" class="os-btn os-btn-danger" onclick="deleteCharacter(\'' +
        key +
        '\', this)">Del</button></div>';
      listEl.appendChild(item);
    });
  }

  window.updateCharacterDisplay = function () {
    const select = $("characterSelect");
    const charCard = $("characterInfoCard");
    const charImageContainer = $("charImagePreview");
    const charName = $("charNameDisplay");
    const refButton = $("charRefButton");

    charCard.classList.remove("visible");
    refButton.classList.add("hidden");
    charImageContainer.innerHTML = "";
    charName.textContent = "---";

    const charId = select.value;
    if (charId && savedCharacters[charId]) {
      const char = savedCharacters[charId];
      charCard.classList.add("visible");
      charName.textContent = char.name;
      if (char.image) {
        charImageContainer.innerHTML =
          '<img src="' + char.image + '" alt="" style="max-height:100%;object-fit:contain">';
      } else {
        charImageContainer.textContent = "No Image";
      }
      if (char.url) refButton.classList.remove("hidden");
    }
  };

  $("characterSelect").addEventListener("change", updateCharacterDisplay);

  window.openCharacterReference = function () {
    const charId = $("characterSelect").value;
    if (charId && savedCharacters[charId] && savedCharacters[charId].url) {
      window.open(savedCharacters[charId].url, "_blank");
    }
  };

  function loadSettings() {
    const saved = localStorage.getItem("e621_blacklist");
    currentBannedList = saved ? JSON.parse(saved) : [];
    const categoriesSaved = localStorage.getItem("e621_categories");
    if (categoriesSaved) {
      try {
        enabledCategories = JSON.parse(categoriesSaved);
      } catch (e) {
        enabledCategories = { general: true, artists: true, species: true, meta: true };
      }
    }
  }

  window.openSettings = function () {
    $("blacklistInput").value = currentBannedList.join(", ");
    $("catGeneral").checked = enabledCategories.general;
    $("catArtists").checked = enabledCategories.artists;
    $("catSpecies").checked = enabledCategories.species;
    $("catMeta").checked = enabledCategories.meta;
    showModal("settingsModal");
  };

  window.closeSettings = function () {
    hideModal("settingsModal");
  };

  window.saveSettings = function () {
    const rawText = $("blacklistInput").value;
    currentBannedList = rawText
      .split(",")
      .map(function (s) {
        return s.trim().toLowerCase().replace(/\s+/g, "_");
      })
      .filter(function (s) {
        return s.length > 0;
      });
    localStorage.setItem("e621_blacklist", JSON.stringify(currentBannedList));
    enabledCategories = {
      general: $("catGeneral").checked,
      artists: $("catArtists").checked,
      species: $("catSpecies").checked,
      meta: $("catMeta").checked,
    };
    localStorage.setItem("e621_categories", JSON.stringify(enabledCategories));
    closeSettings();
    showToast("Settings Saved!");
    if ($("resultsArea").classList.contains("visible")) fetchTags();
  };

  window.resetDefaultBlacklist = function () {
    $("blacklistInput").value = DEFAULT_BANNED_SUFFIXES.join(", ");
    showToast("Blacklist input cleared.");
  };

  async function ensureJSZip() {
    if (window.JSZip) return window.JSZip;
    return new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
      s.onload = function () {
        resolve(window.JSZip);
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  window.exportMikus = async function () {
    try {
      const JSZip = await ensureJSZip();
      const zip = new JSZip();
      zip.file("negative.txt", (currentBannedList || []).join(", "));
      const charCopy = {};
      Object.keys(savedCharacters).forEach(function (id) {
        const c = savedCharacters[id];
        charCopy[c.name] = {
          type: c.type || "solo",
          img: c.image || "",
          ref_url: c.url || "",
          prompt: c.tags || "",
        };
      });
      zip.file("characher.json", JSON.stringify(charCopy, null, 2));
      const content = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(content);
      a.download = "export.mikus";
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast("Exported .mikus");
    } catch (e) {
      showToast("Export failed", true);
    }
  };

  window.handleImportMikus = async function () {
    const input = $("importMikusFile");
    if (!input.files || !input.files[0]) {
      showToast("Select a .mikus file first", true);
      return;
    }
    try {
      const JSZip = await ensureJSZip();
      const zip = await JSZip.loadAsync(await input.files[0].arrayBuffer());
      if (zip.file("negative.txt")) {
        const negText = await zip.file("negative.txt").async("string");
        currentBannedList = negText
          .split(",")
          .map(function (s) {
            return s.trim().toLowerCase().replace(/\s+/g, "_");
          })
          .filter(Boolean);
        localStorage.setItem("e621_blacklist", JSON.stringify(currentBannedList));
      }
      if (zip.file("characher.json")) {
        const parsed = JSON.parse(await zip.file("characher.json").async("string"));
        const newChars = {};
        Object.keys(parsed).forEach(function (name) {
          const entry = parsed[name];
          newChars["char_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8)] = {
            name,
            tags: entry.prompt || "",
            type: entry.type || "solo",
            url: entry.ref_url || "",
            image: entry.img || "",
          };
        });
        savedCharacters = newChars;
        saveCharacters();
        renderCharacterList();
        updatePresetDropdown(currentMode);
        updateCharacterDisplay();
      }
      showToast("Imported .mikus");
      input.value = "";
    } catch (e) {
      showToast("Import failed", true);
    }
  };

  function setupMikusDropzone() {
    const drop = $("mikusDropzone");
    const input = $("importMikusFile");
    const nameEl = $("mikusFileName");
    if (!drop || !input) return;
    drop.addEventListener("click", function () {
      input.click();
    });
    input.addEventListener("change", function () {
      nameEl.textContent = input.files && input.files[0] ? input.files[0].name : "";
    });
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        drop.classList.add("drag");
      });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        drop.classList.remove("drag");
      });
    });
    drop.addEventListener("drop", function (e) {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) {
        input.files = e.dataTransfer.files;
        nameEl.textContent = f.name;
      }
    });
  }

  window.fetchTags = async function () {
    const input = $("urlInput").value.trim();
    const errorDiv = $("errorMessage");
    const loading = $("loadingSpinner");
    const results = $("resultsArea");
    const tagsContainer = $("tagsContainer");
    const duoMessage = $("duoMessage");
    const imgPreview = $("postImage");
    const imgPlaceholder = $("imagePlaceholder");

    errorDiv.classList.remove("visible");
    results.classList.remove("visible");
    tagsContainer.innerHTML = "";
    duoMessage.classList.remove("visible");
    imgPreview.classList.add("hidden");
    imgPreview.src = "";
    imgPlaceholder.classList.remove("hidden");
    $("characterSelect").disabled = false;
    $("characterSelect").value = "";

    if (!input) {
      showError("Please enter a URL.");
      return;
    }

    const idMatch = input.match(/posts\/(\d+)/);
    if (!idMatch) {
      showError("Post ID not found. Format: e621.net/posts/XXXXX");
      return;
    }
    $("postIdDisplay").textContent = idMatch[1];
    loading.classList.add("visible");

    try {
      let e621Data;
      const apiUrl = "https://e621.net/posts/" + idMatch[1] + ".json";
      try {
        const res1 = await fetch(
          "https://api.allorigins.win/get?url=" + encodeURIComponent(apiUrl)
        );
        if (!res1.ok) throw new Error();
        e621Data = JSON.parse((await res1.json()).contents);
      } catch (err1) {
        const res2 = await fetch(
          "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(apiUrl)
        );
        if (!res2.ok) throw new Error("Failed to load post data.");
        e621Data = await res2.json();
      }

      if (!e621Data || !e621Data.post) throw new Error("Post data not found.");
      const post = e621Data.post;
      const imgUrl = post.sample.url || post.file.url || post.preview.url;
      if (imgUrl) {
        imgPreview.src = imgUrl;
        imgPreview.onclick = function () {
          openImageZoom(imgPreview);
        };
        imgPreview.onload = function () {
          imgPreview.classList.remove("hidden");
          imgPlaceholder.classList.add("hidden");
        };
        imgPreview.onerror = function () {
          imgPlaceholder.textContent = "Image Unavailable";
        };
      } else {
        imgPlaceholder.textContent = "No Image";
      }

      let generalTags = post.tags.general || [];
      if (generalTags.length === 0) throw new Error("No General tags found.");

      if (generalTags.includes("duo")) {
        updatePresetDropdown("duo");
        duoMessage.classList.add("visible");
      } else {
        updatePresetDropdown("solo");
      }
      updateCharacterDisplay();

      let filteredTags = [];
      if (enabledCategories.general && post.tags.general) filteredTags.push.apply(filteredTags, post.tags.general);
      if (enabledCategories.artists && post.tags.artist) filteredTags.push.apply(filteredTags, post.tags.artist);
      if (enabledCategories.species && post.tags.species) filteredTags.push.apply(filteredTags, post.tags.species);
      if (enabledCategories.meta && post.tags.meta) filteredTags.push.apply(filteredTags, post.tags.meta);

      const commonColors = [
        "blue",
        "red",
        "green",
        "yellow",
        "black",
        "white",
        "orange",
        "purple",
        "pink",
        "brown",
        "grey",
        "gray",
        "blonde",
        "silver",
        "gold",
      ];

      generalTags = filteredTags.filter(function (tag) {
        const lowerTag = tag.toLowerCase();
        const tagParts = lowerTag.split("_");
        for (let i = 0; i < currentBannedList.length; i++) {
          const banned = currentBannedList[i];
          if (lowerTag === banned) return false;
          if (lowerTag.endsWith("_" + banned)) return false;
          if (tagParts.indexOf(banned) >= 0) return false;
        }
        if (commonColors.indexOf(lowerTag) >= 0) return false;
        return true;
      });

      generalTags.sort();
      $("tagCount").textContent = generalTags.length;

      generalTags.forEach(function (tag) {
        const displayTag = tag.replace(/_/g, " ");
        const tagEl = document.createElement("div");
        tagEl.className = "tag-pill";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "tag-checkbox";
        checkbox.onclick = function (e) {
          e.stopPropagation();
        };
        const textSpan = document.createElement("span");
        textSpan.textContent = displayTag;
        textSpan.title = "Click to copy";
        textSpan.onclick = function (e) {
          e.stopPropagation();
          copyText(displayTag);
          tagEl.classList.add("copied");
          setTimeout(function () {
            tagEl.classList.remove("copied");
          }, 800);
        };
        tagEl.appendChild(checkbox);
        tagEl.appendChild(textSpan);
        tagEl.dataset.copyText = displayTag;
        checkbox.onchange = function () {
          const hasChecked = tagsContainer.querySelector(".tag-checkbox:checked");
          $("deleteSelectedBtn").classList.toggle("hidden", !hasChecked);
        };
        tagsContainer.appendChild(tagEl);
      });

      results.classList.add("visible");
    } catch (err) {
      showError(err.message);
    } finally {
      loading.classList.remove("visible");
    }
  };

  function showError(message) {
    $("errorText").textContent = message;
    $("errorMessage").classList.add("visible");
  }

  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      showToast("Copied!");
    } catch (err) {
      showToast("Copy failed", true);
    }
    document.body.removeChild(ta);
  }

  function copyText(text) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          showToast("Copied!");
        },
        function () {
          fallbackCopy(text);
        }
      );
    } else fallbackCopy(text);
  }

  window.copyAllTags = function () {
    const tagsList = [];
    document.querySelectorAll("#tagsContainer .tag-pill").forEach(function (el) {
      tagsList.push(el.dataset.copyText);
    });
    if (tagsList.length === 0) {
      showToast("No tags to copy!", true);
      return;
    }
    let finalString = tagsList.join(", ");
    const val = $("characterSelect").value;
    if (val && savedCharacters[val]) {
      finalString = savedCharacters[val].tags + ", BREAK, " + finalString;
    }
    copyText(finalString);
  };

  function showToast(message, isError) {
    const toast = $("toast");
    const msg = $("toastMsg");
    toast.className = "e621-toast" + (isError ? " error" : " ok");
    msg.textContent = message;
    toast.classList.add("visible");
    setTimeout(function () {
      toast.classList.remove("visible");
    }, 3000);
  }

  window.clearResults = function () {
    $("resultsArea").classList.remove("visible");
    $("urlInput").value = "";
    $("characterInfoCard").classList.remove("visible");
    $("urlInput").focus();
  };

  window.openImageZoom = function (imgElement) {
    $("zoomImage").src = imgElement.src;
    $("imageZoomModal").classList.add("active");
  };

  window.closeImageZoom = function (event) {
    if (event && event.target.id !== "imageZoomModal") return;
    $("imageZoomModal").classList.remove("active");
  };

  window.deleteSelectedTags = function () {
    const checked = document.querySelectorAll("#tagsContainer .tag-checkbox:checked");
    if (checked.length === 0) {
      showToast("No tags selected", true);
      return;
    }
    checked.forEach(function (checkbox) {
      const tagEl = checkbox.closest(".tag-pill");
      if (tagEl) tagEl.remove();
    });
    if (!document.querySelector("#tagsContainer .tag-checkbox:checked")) {
      $("deleteSelectedBtn").classList.add("hidden");
    }
    showToast("Deleted " + checked.length + " tag(s)");
  };
