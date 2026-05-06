const DB_NAME = "family-health-local-db";
const DB_VERSION = 1;
const STORE_NAMES = ["members", "vitals", "reports", "medicines", "images"];

const state = {
  db: null,
  members: [],
  activeMemberId: "",
  vitals: [],
  reports: [],
  medicines: [],
  images: [],
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function todayInputValue() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      STORE_NAMES.forEach((name) => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: "id" });
        }
      });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txStore(name, mode = "readonly") {
  return state.db.transaction(name, mode).objectStore(name);
}

function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const request = txStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function saveRecord(storeName, record) {
  return new Promise((resolve, reject) => {
    const request = txStore(storeName, "readwrite").put(record);
    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error);
  });
}

function deleteRecord(storeName, id) {
  return new Promise((resolve, reject) => {
    const request = txStore(storeName, "readwrite").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        dataUrl: reader.result,
      });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function loadState() {
  const [members, vitals, reports, medicines, images] = await Promise.all(
    STORE_NAMES.map(getAll),
  );
  state.members = members.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  state.vitals = vitals.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  state.reports = reports.sort((a, b) => b.examDate.localeCompare(a.examDate));
  state.medicines = medicines.sort((a, b) => b.startDate.localeCompare(a.startDate));
  state.images = images.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const savedMember = localStorage.getItem("family-health-active-member");
  const hasSavedMember = state.members.some((member) => member.id === savedMember);
  state.activeMemberId = hasSavedMember ? savedMember : state.members[0]?.id || "";
}

async function seedDefaultMember() {
  if (state.members.length) return;
  const member = {
    id: createId("member"),
    name: "本人",
    relation: "本人",
    birthDate: "",
    gender: "",
    notes: "",
    createdAt: new Date().toISOString(),
  };
  await saveRecord("members", member);
}

function activeMember() {
  return state.members.find((member) => member.id === state.activeMemberId);
}

function memberScoped(records) {
  return records.filter((record) => record.memberId === state.activeMemberId);
}

function renderMemberPicker() {
  const picker = $("#activeMember");
  picker.innerHTML = state.members
    .map(
      (member) =>
        `<option value="${member.id}" ${member.id === state.activeMemberId ? "selected" : ""}>${escapeHtml(member.name)}</option>`,
    )
    .join("");
}

function renderDashboard() {
  const vitals = memberScoped(state.vitals);
  const reports = memberScoped(state.reports);
  const medicines = memberScoped(state.medicines);
  const images = memberScoped(state.images);

  $("#memberCount").textContent = state.members.length;
  $("#vitalCount").textContent = vitals.length;
  $("#reportCount").textContent = reports.length;
  $("#medicineCount").textContent = medicines.length;

  $("#recentVitals").innerHTML =
    vitals.slice(0, 5).map(renderVitalRowCard).join("") ||
    `<div class="empty-state">暂无血糖血压记录</div>`;

  const member = activeMember();
  $("#profileSnapshot").innerHTML = member
    ? `
      <div class="list-row"><strong>姓名</strong><span>${escapeHtml(member.name)}</span></div>
      <div class="list-row"><strong>关系</strong><span>${escapeHtml(member.relation || "-")}</span></div>
      <div class="list-row"><strong>出生日期</strong><span>${member.birthDate ? formatDate(member.birthDate) : "-"}</span></div>
      <div class="list-row"><strong>性别</strong><span>${escapeHtml(member.gender || "-")}</span></div>
      <div class="list-row"><strong>图片资料</strong><span>${images.length} 项</span></div>
      <div class="list-row"><strong>过敏史/基础病</strong><span>${escapeHtml(member.notes || "-")}</span></div>
    `
    : `<div class="empty-state">暂无成员</div>`;

  drawVitalsChart(vitals.slice(0, 20).reverse());
}

function renderVitals() {
  const rows = memberScoped(state.vitals)
    .map(
      (record) => `
        <tr>
          <td>${formatDateTime(record.recordedAt)}</td>
          <td>${valueOrDash(record.bloodSugar)}</td>
          <td>${valueOrDash(record.systolic)}</td>
          <td>${valueOrDash(record.diastolic)}</td>
          <td>${escapeHtml(record.context)}</td>
          <td>${escapeHtml(record.notes || "")}</td>
          <td><button class="danger-button" data-delete="vitals" data-id="${record.id}" type="button">删除</button></td>
        </tr>
      `,
    )
    .join("");
  $("#vitalsTable").innerHTML =
    rows || `<tr><td colspan="7"><div class="empty-state">暂无记录</div></td></tr>`;
}

function renderReports() {
  const html = memberScoped(state.reports)
    .map(
      (report) => `
        <article class="item-card">
          <h4>${escapeHtml(report.title)}</h4>
          <span>${formatDate(report.examDate)}</span>
          <p>${escapeHtml(report.summary || "未填写摘要")}</p>
          ${report.file ? `<a class="ghost-button" href="${report.file.dataUrl}" download="${escapeHtml(report.file.name)}">下载附件</a>` : ""}
          <button class="danger-button" data-delete="reports" data-id="${report.id}" type="button">删除</button>
        </article>
      `,
    )
    .join("");
  $("#reportsList").innerHTML = html || `<div class="empty-state">暂无体检报告</div>`;
}

function renderMedicines() {
  const html = memberScoped(state.medicines)
    .map(
      (medicine) => `
        <article class="item-card">
          <h4>${escapeHtml(medicine.name)}</h4>
          <span>${escapeHtml(medicine.status)} · ${formatDate(medicine.startDate)} 至 ${medicine.endDate ? formatDate(medicine.endDate) : "今"}</span>
          <p>${escapeHtml([medicine.dosage, medicine.frequency].filter(Boolean).join("，") || "未填写剂量频次")}</p>
          <p>${escapeHtml(medicine.notes || "")}</p>
          <button class="danger-button" data-delete="medicines" data-id="${medicine.id}" type="button">删除</button>
        </article>
      `,
    )
    .join("");
  $("#medicineList").innerHTML = html || `<div class="empty-state">暂无用药记录</div>`;
}

function renderImages() {
  const html = memberScoped(state.images)
    .map(
      (image) => `
        <article class="image-card">
          <img src="${image.file.dataUrl}" alt="${escapeHtml(image.title)}" />
          <h4>${escapeHtml(image.title)}</h4>
          <span>${escapeHtml(image.category)} · ${formatDateTime(image.createdAt)}</span>
          <p>${escapeHtml(image.notes || "")}</p>
          <button class="danger-button" data-delete="images" data-id="${image.id}" type="button">删除</button>
        </article>
      `,
    )
    .join("");
  $("#imageList").innerHTML = html || `<div class="empty-state">暂无图片资料</div>`;
}

function renderMembers() {
  const html = state.members
    .map(
      (member) => `
        <div class="list-row">
          <div>
            <strong>${escapeHtml(member.name)}</strong>
            <span>${escapeHtml(member.relation || "未填写关系")} · ${escapeHtml(member.gender || "未填写性别")}</span>
          </div>
          <button class="danger-button" data-delete-member="${member.id}" type="button">删除</button>
        </div>
      `,
    )
    .join("");
  $("#memberList").innerHTML = html || `<div class="empty-state">暂无成员</div>`;
}

function renderMarkdown() {
  $("#markdownOutput").value = generateMarkdown();
}

function renderAll() {
  renderMemberPicker();
  renderDashboard();
  renderVitals();
  renderReports();
  renderMedicines();
  renderImages();
  renderMembers();
  renderMarkdown();
}

function renderVitalRowCard(record) {
  return `
    <div class="list-row">
      <div>
        <strong>${formatDateTime(record.recordedAt)}</strong>
        <span>${escapeHtml(record.context || "")}</span>
      </div>
      <span>血糖 ${valueOrDash(record.bloodSugar)} · 血压 ${valueOrDash(record.systolic)}/${valueOrDash(record.diastolic)}</span>
    </div>
  `;
}

function drawVitalsChart(records) {
  const canvas = $("#vitalsChart");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(600, Math.floor(rect.width * dpr));
  canvas.height = Math.floor(360 * dpr);
  ctx.scale(dpr, dpr);

  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fbfcfb";
  ctx.fillRect(0, 0, width, height);

  if (!records.length) {
    ctx.fillStyle = "#62706a";
    ctx.font = "15px Microsoft YaHei, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("暂无可视化数据", width / 2, height / 2);
    return;
  }

  const padding = { top: 26, right: 26, bottom: 56, left: 54 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const series = [
    { key: "bloodSugar", label: "血糖", color: "#187760" },
    { key: "systolic", label: "收缩压", color: "#c35a2c" },
    { key: "diastolic", label: "舒张压", color: "#3a6ea5" },
  ];
  const values = records.flatMap((record) =>
    series.map((item) => Number(record[item.key])).filter(Number.isFinite),
  );
  const max = Math.max(...values, 10);
  const min = Math.min(...values, 0);
  const yMin = Math.max(0, Math.floor(min - 5));
  const yMax = Math.ceil(max + 8);

  ctx.strokeStyle = "#d9e2de";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#62706a";
  ctx.font = "12px Microsoft YaHei, sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i <= 5; i += 1) {
    const y = padding.top + (plotHeight / 5) * i;
    const value = Math.round(yMax - ((yMax - yMin) / 5) * i);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillText(String(value), padding.left - 10, y + 4);
  }

  const xFor = (index) =>
    padding.left + (records.length === 1 ? plotWidth / 2 : (plotWidth / (records.length - 1)) * index);
  const yFor = (value) =>
    padding.top + plotHeight - ((value - yMin) / (yMax - yMin || 1)) * plotHeight;

  series.forEach((item) => {
    const points = records
      .map((record, index) => ({ x: xFor(index), y: yFor(Number(record[item.key])), value: record[item.key] }))
      .filter((point) => Number.isFinite(Number(point.value)));
    if (!points.length) return;
    ctx.strokeStyle = item.color;
    ctx.fillStyle = item.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    points.forEach((point) => {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  ctx.textAlign = "center";
  ctx.fillStyle = "#62706a";
  records.forEach((record, index) => {
    const label = new Date(record.recordedAt).toLocaleDateString("zh-CN", {
      month: "numeric",
      day: "numeric",
    });
    ctx.fillText(label, xFor(index), height - 24);
  });

  let legendX = padding.left;
  series.forEach((item) => {
    ctx.fillStyle = item.color;
    ctx.fillRect(legendX, 12, 10, 10);
    ctx.fillStyle = "#16211d";
    ctx.textAlign = "left";
    ctx.fillText(item.label, legendX + 16, 22);
    legendX += 76;
  });
}

function generateMarkdown() {
  const member = activeMember();
  if (!member) return "# 家庭健康信息\n\n暂无成员信息。";

  const vitals = memberScoped(state.vitals);
  const reports = memberScoped(state.reports);
  const medicines = memberScoped(state.medicines);
  const images = memberScoped(state.images);
  const latestVitals = vitals[0];

  return [
    `# ${member.name} 健康信息摘要`,
    "",
    "> 用途：提交给 ChatGPT 整理为便于医生快速判断的材料。请在发送给医生前核对数据准确性。",
    "",
    "## 个人信息",
    "",
    `- 姓名：${member.name}`,
    `- 关系：${member.relation || "未填写"}`,
    `- 性别：${member.gender || "未填写"}`,
    `- 出生日期：${member.birthDate || "未填写"}`,
    `- 过敏史/基础病：${member.notes || "未填写"}`,
    "",
    "## 最新指标",
    "",
    latestVitals
      ? `- ${formatDateTime(latestVitals.recordedAt)}：血糖 ${valueOrDash(latestVitals.bloodSugar)} mmol/L，血压 ${valueOrDash(latestVitals.systolic)}/${valueOrDash(latestVitals.diastolic)} mmHg，场景 ${latestVitals.context || "未填写"}`
      : "- 暂无血糖血压记录",
    "",
    "## 血糖血压历史",
    "",
    vitals.length
      ? "| 时间 | 血糖 mmol/L | 收缩压 mmHg | 舒张压 mmHg | 场景 | 备注 |\n| --- | ---: | ---: | ---: | --- | --- |\n" +
        vitals
          .map(
            (record) =>
              `| ${formatDateTime(record.recordedAt)} | ${valueOrDash(record.bloodSugar)} | ${valueOrDash(record.systolic)} | ${valueOrDash(record.diastolic)} | ${record.context || ""} | ${record.notes || ""} |`,
          )
          .join("\n")
      : "暂无记录。",
    "",
    "## 体检报告",
    "",
    reports.length
      ? reports
          .map(
            (report, index) =>
              `${index + 1}. ${report.title}（${report.examDate}）\n   - 摘要：${report.summary || "未填写"}\n   - 附件：${report.file?.name || "无"}`,
          )
          .join("\n")
      : "暂无体检报告。",
    "",
    "## 用药历史",
    "",
    medicines.length
      ? medicines
          .map(
            (medicine, index) =>
              `${index + 1}. ${medicine.name}，${medicine.dosage || "剂量未填"}，${medicine.frequency || "频次未填"}，${medicine.status}，${medicine.startDate} 至 ${medicine.endDate || "今"}。\n   - 备注：${medicine.notes || "无"}`,
          )
          .join("\n")
      : "暂无用药历史。",
    "",
    "## 图片资料索引",
    "",
    images.length
      ? images
          .map(
            (image, index) =>
              `${index + 1}. ${image.title}（${image.category}，${formatDateTime(image.createdAt)}）\n   - 文件：${image.file.name}\n   - 说明：${image.notes || "无"}`,
          )
          .join("\n")
      : "暂无图片资料。",
    "",
    "## 希望 ChatGPT 帮助整理的问题",
    "",
    "- 请按医生阅读习惯整理为病情摘要、异常指标、用药情况、检查报告重点和建议就诊时补充的问题。",
    "- 请标注哪些信息仍缺失，需要进一步询问或补充检查。",
  ].join("\n");
}

function bindEvents() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".nav-item").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      $$(".view").forEach((view) => view.classList.remove("active"));
      $(`#${button.dataset.view}View`).classList.add("active");
      $("#viewTitle").textContent = button.textContent;
      renderMarkdown();
    });
  });

  $("#activeMember").addEventListener("change", (event) => {
    state.activeMemberId = event.target.value;
    localStorage.setItem("family-health-active-member", state.activeMemberId);
    renderAll();
  });

  $("#openMemberDialog").addEventListener("click", () => $("#memberDialog").showModal());
  $("#closeMemberDialog").addEventListener("click", () => $("#memberDialog").close());

  $("#memberForm").addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const member = {
      id: createId("member"),
      name: data.name.trim(),
      relation: data.relation.trim(),
      birthDate: data.birthDate,
      gender: data.gender,
      notes: data.notes.trim(),
      createdAt: new Date().toISOString(),
    };
    await saveRecord("members", member);
    state.activeMemberId = member.id;
    localStorage.setItem("family-health-active-member", member.id);
    form.reset();
    if (event.submitter?.dataset.closeAfter === "true") {
      $("#memberDialog").close();
    }
    await refresh(event.submitter?.dataset.closeAfter === "true" ? "成员已添加，已退出成员管理" : "成员已添加");
  });

  $("#vitalForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    await saveRecord("vitals", {
      id: createId("vital"),
      memberId: state.activeMemberId,
      recordedAt: new Date(data.recordedAt).toISOString(),
      bloodSugar: data.bloodSugar ? Number(data.bloodSugar) : "",
      systolic: data.systolic ? Number(data.systolic) : "",
      diastolic: data.diastolic ? Number(data.diastolic) : "",
      context: data.context,
      notes: data.notes.trim(),
      createdAt: new Date().toISOString(),
    });
    event.currentTarget.reset();
    event.currentTarget.recordedAt.value = todayInputValue();
    await refresh("血糖血压记录已保存");
  });

  $("#reportForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const file = await fileToDataUrl(form.file.files[0]);
    await saveRecord("reports", {
      id: createId("report"),
      memberId: state.activeMemberId,
      title: data.title.trim(),
      examDate: data.examDate,
      summary: data.summary.trim(),
      file,
      createdAt: new Date().toISOString(),
    });
    form.reset();
    await refresh("体检报告已保存");
  });

  $("#medicineForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    await saveRecord("medicines", {
      id: createId("medicine"),
      memberId: state.activeMemberId,
      name: data.name.trim(),
      dosage: data.dosage.trim(),
      frequency: data.frequency.trim(),
      startDate: data.startDate,
      endDate: data.endDate,
      status: data.status,
      notes: data.notes.trim(),
      createdAt: new Date().toISOString(),
    });
    event.currentTarget.reset();
    await refresh("用药记录已保存");
  });

  $("#imageForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const file = await fileToDataUrl(form.file.files[0]);
    await saveRecord("images", {
      id: createId("image"),
      memberId: state.activeMemberId,
      title: data.title.trim(),
      category: data.category,
      notes: data.notes.trim(),
      file,
      createdAt: new Date().toISOString(),
    });
    form.reset();
    await refresh("图片资料已保存");
  });

  document.addEventListener("click", async (event) => {
    const deleteButton = event.target.closest("[data-delete]");
    const deleteMemberButton = event.target.closest("[data-delete-member]");
    if (deleteButton) {
      await deleteRecord(deleteButton.dataset.delete, deleteButton.dataset.id);
      await refresh("记录已删除");
    }
    if (deleteMemberButton) {
      const deleted = await deleteMember(deleteMemberButton.dataset.deleteMember);
      await refresh(deleted ? "成员已删除" : "");
    }
  });

  $("#copyMarkdown").addEventListener("click", async () => {
    renderMarkdown();
    await navigator.clipboard.writeText($("#markdownOutput").value);
    showToast("Markdown 已复制");
  });

  $("#downloadMarkdown").addEventListener("click", () => {
    renderMarkdown();
    const member = activeMember();
    const blob = new Blob([$("#markdownOutput").value], {
      type: "text/markdown;charset=utf-8",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${member?.name || "健康信息"}-健康摘要.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  });

  window.addEventListener("resize", () => drawVitalsChart(memberScoped(state.vitals).slice(0, 20).reverse()));
}

async function deleteMember(memberId) {
  if (state.members.length <= 1) {
    showToast("至少保留一个成员");
    return false;
  }
  await deleteRecord("members", memberId);
  await Promise.all(
    STORE_NAMES.filter((storeName) => storeName !== "members").map(async (storeName) => {
      const records = await getAll(storeName);
      await Promise.all(
        records
          .filter((record) => record.memberId === memberId)
          .map((record) => deleteRecord(storeName, record.id)),
      );
    }),
  );
  return true;
}

async function refresh(message) {
  await loadState();
  renderAll();
  if (message) showToast(message);
}

function valueOrDash(value) {
  return value === "" || value === undefined || value === null ? "-" : value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function init() {
  state.db = await openDatabase();
  await loadState();
  await seedDefaultMember();
  await loadState();
  bindEvents();
  $("#vitalForm").recordedAt.value = todayInputValue();
  renderAll();
}

init().catch((error) => {
  console.error(error);
  showToast("初始化失败，请确认浏览器支持 IndexedDB");
});
