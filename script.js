import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc, updateDoc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// ── FIREBASE CONFIG ─────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyABnIqY_TFl3rRvf3A5PKlRrS9O5oqcHo0",
  authDomain: "cambodia-pub-menu.firebaseapp.com",
  projectId: "cambodia-pub-menu",
  storageBucket: "cambodia-pub-menu.firebasestorage.app",
  messagingSenderId: "43253750996",
  appId: "1:43253750996:web:2e0719c6b0d2e04a3def41"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// ── STATE ───────────────────────────────────────
const PASS = 'admin123';
let items = [];
let categories = ['ស្រា & បៀរ','គុយទាវ & បាយ','សាច់អាំង','ភេសជ្ជៈ','បង្អែម'];
let activeTab = 'ទាំងអស់';
let editingFirebaseId = null;
let pendingImgFile = null;   // File object waiting to upload (modal)
let pendingImgPreview = null; // base64 preview already shown
let cardUploadFirebaseId = null;

// ── TOAST ───────────────────────────────────────
let toastTimer;
function showToast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' '+type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ── LOADING ─────────────────────────────────────
function setLoading(on) {
  document.getElementById('loadingOverlay').style.display = on ? 'flex' : 'none';
}

// ── VIEWS ───────────────────────────────────────
function setView(id) {
  ['viewLogin','viewCustomer','viewAdmin'].forEach(v => {
    document.getElementById(v).classList.remove('active');
  });
  document.getElementById(id).classList.add('active');
}
window.showCustomer = function() {
  setView('viewCustomer');
  renderCustomer();
  // Auto-scroll to the menu grid so the customer immediately sees the menu/cart
  const grid = document.getElementById('cGrid');
  if (grid) {
    grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    window.scrollTo({ top:0, behavior:'smooth' });
  }
};
function showAdmin() {
  setView('viewAdmin');
  renderAdmin();
}
window.doLogin = function() {
  const v = document.getElementById('loginPass').value;
  if (v === PASS) { document.getElementById('loginErr').textContent=''; showAdmin(); }
  else { document.getElementById('loginErr').textContent='❌ លេខសម្ងាត់មិនត្រឹមត្រូវ'; document.getElementById('loginPass').value=''; }
};
window.doLogout = function() { showCustomer(); };
window.openAdminModal = function() {
  document.getElementById('miniPass').value='';
  document.getElementById('miniErr').textContent='';
  document.getElementById('adminMiniOverlay').classList.add('open');
  setTimeout(() => document.getElementById('miniPass').focus(), 120);
};
window.closeAdminModal = function() { document.getElementById('adminMiniOverlay').classList.remove('open'); };
window.doMiniLogin = function() {
  const v = document.getElementById('miniPass').value;
  if (v === PASS) { window.closeAdminModal(); showAdmin(); }
  else { document.getElementById('miniErr').textContent='❌ Password incorrect'; document.getElementById('miniPass').value=''; }
};

// ── FIREBASE: LOAD CATEGORIES ───────────────────
async function loadCategories() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'menuConfig'));
    if (snap.exists() && snap.data().categories?.length) {
      categories = snap.data().categories;
    } else {
      // First time: save defaults
      await setDoc(doc(db, 'settings', 'menuConfig'), { categories });
    }
  } catch(e) { console.warn('loadCategories error', e); }
}

async function saveCategories() {
  try {
    await setDoc(doc(db, 'settings', 'menuConfig'), { categories });
  } catch(e) { showToast('មានបញ្ហា: '+e.message, 'error'); }
}

// ── FIREBASE: LOAD ITEMS ────────────────────────
async function loadItems() {
  try {
    const snap = await getDocs(collection(db, 'menuItems'));
    items = snap.docs.map(d => ({ firebaseId: d.id, ...d.data() }));
  } catch(e) { showToast('មានបញ្ហាផ្ទុកទិន្នន័យ', 'error'); }
}

// ── FIREBASE: UPLOAD IMAGE ──────────────────────
// Returns download URL string, or null on failure
async function uploadImage(file) {
  if (!file) return null;
  // Validate size (5MB max)
  if (file.size > 5 * 1024 * 1024) {
    showToast('រូបភាពធំពេក — max 5MB', 'error');
    return null;
  }
  // Upload to Cloudinary (unsigned preset)
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', 'cambodia_pub'); // preset name

    const resp = await fetch('https://api.cloudinary.com/v1_1/dismpss5e/image/upload', {
      method: 'POST',
      body: formData
    });
    const data = await resp.json();
    if (resp.ok && data.secure_url) {
      return data.secure_url;
    } else {
      console.error('Cloudinary upload failed:', data);
      showToast('Upload failed: ' + (data.error?.message || 'Cloudinary error'), 'error');
      return null;
    }
  } catch (e) {
    console.error('Cloudinary upload error:', e);
    showToast('Upload failed: ' + (e.message || e), 'error');
    return null;
  }
}

// ── HELPER: Upload to Cloudinary and save URL to Firestore ─────────
// Usage: await handleImageUploadAndSave(file, firebaseDocumentId)
async function handleImageUploadAndSave(file, documentId) {
  if (!file) { console.warn('No file provided'); return null; }
  if (!documentId) { console.warn('No documentId provided'); return null; }
  if (file.size > 5 * 1024 * 1024) { showToast('រូបភាពធំពេក — max 5MB', 'error'); return null; }

  try {
    showToast('កំពុង Upload រូបភាព...');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', 'cambodia_pub');

    const resp = await fetch('https://api.cloudinary.com/v1_1/dismpss5e/image/upload', {
      method: 'POST',
      body: formData
    });
    const data = await resp.json();
    if (!resp.ok) {
      const msg = data?.error?.message || 'Cloudinary upload failed';
      throw new Error(msg);
    }
    const imageUrl = data.secure_url;
    if (!imageUrl) throw new Error('No secure_url returned from Cloudinary');

    // Save URL to Firestore document
    const docRef = doc(db, 'menuItems', documentId);
    await updateDoc(docRef, { img: imageUrl });

    showToast('Upload និងរក្សាទុករួចរាល់ ✓', 'success');
    return imageUrl;
  } catch (err) {
    console.error('handleImageUploadAndSave error:', err);
    showToast('Error: ' + (err.message || err), 'error');
    return null;
  }
}

// ── HELPER: Edit a menu item's fields in Firestore ─────────
// Usage: await editMenuItem(documentId, { price: '$4.00', img: 'https://...' })
async function editMenuItem(documentId, updatedFields) {
  if (!documentId || !updatedFields) {
    console.warn('editMenuItem: missing documentId or updatedFields');
    return null;
  }
  try {
    const docRef = doc(db, 'menuItems', documentId);
    await updateDoc(docRef, updatedFields);
    showToast('Item updated ✓', 'success');
    // Refresh local state & UI
    await loadItems();
    renderAdminTabs();
    renderAdminGrid();
    renderCustomerGrid(activeTab);
    return true;
  } catch (e) {
    console.error('editMenuItem error:', e);
    showToast('Update failed: ' + (e.message || e), 'error');
    return null;
  }
}
window.editMenuItem = editMenuItem;

// ── CUSTOMER RENDER ─────────────────────────────
function renderCustomer() {
  const tabs = document.getElementById('cTabs');
  const cats = ['ទាំងអស់', ...categories];
  tabs.innerHTML = cats.map(c =>
    `<button class="c-tab ${c===activeTab?'active':''}" onclick="window.filterCustomer('${c}',this)">${c}</button>`
  ).join('');
  renderCustomerGrid(activeTab);
}
window.filterCustomer = function(cat, btn) {
  activeTab = cat;
  document.querySelectorAll('.c-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderCustomerGrid(cat);
};
function renderCustomerGrid(cat) {
  const g = document.getElementById('cGrid');
  const filtered = cat === 'ទាំងអស់' ? items : items.filter(i => i.category === cat);
  if (!filtered.length) { g.innerHTML = '<div class="c-empty">មិនទាន់មានម្ហូបក្នុងប្រភេទនេះ</div>'; return; }
  if (cat === 'ទាំងអស់') {
    let html = '';
    categories.forEach(c => {
      const ci = items.filter(i => i.category === c);
      if (!ci.length) return;
      html += `<div class="c-cat-label">${c}</div><div class="c-grid">${ci.map(cardCustomer).join('')}</div>`;
    });
    g.innerHTML = html || '<div class="c-empty">មិនទាន់មានម្ហូប</div>';
  } else {
    g.innerHTML = `<div class="c-grid">${filtered.map(cardCustomer).join('')}</div>`;
  }
}
function cardCustomer(item) {
  const img = item.img
    ? `<div class="c-card-img"><img src="${item.img}" alt="${item.name}" loading="lazy"></div>`
    : `<div class="c-card-no-img">🍽</div>`;
  return `<div class="c-card">${img}<div class="c-card-body">
    <div class="c-card-cat">${item.category}</div>
    <div class="c-card-name">${item.name}</div>
    <div class="c-card-desc">${item.desc||''}</div>
    <span class="c-card-price">${item.price}</span>
  </div></div>`;
}

// ── ADMIN RENDER ────────────────────────────────
function renderAdmin() { renderAdminCatChips(); renderAdminTabs(); renderAdminGrid(); }

function renderAdminCatChips() {
  document.getElementById('adminCatChips').innerHTML = categories.map((c,i) =>
    `<div class="cat-chip">${c}<button class="cat-chip-del" onclick="window.deleteCat(${i})">✕</button></div>`
  ).join('');
}
window.deleteCat = async function(i) {
  const c = categories[i];
  if (items.some(x => x.category === c)) { showToast('សូមលុបម្ហូបក្នុងប្រភេទនេះជាមុន', 'error'); return; }
  if (!confirm(`លុបប្រភេទ "${c}"?`)) return;
  categories.splice(i, 1);
  if (activeTab === c) activeTab = 'ទាំងអស់';
  await saveCategories();
  renderAdmin();
  showToast('លុបប្រភេទ: ' + c);
};
window.addCategory = async function() {
  const v = document.getElementById('newCatInput').value.trim();
  if (!v) { showToast('សូមបញ្ចូលឈ្មោះ'); return; }
  if (categories.includes(v)) { showToast('ប្រភេទនេះមានរួចហើយ'); return; }
  categories.push(v);
  await saveCategories();
  document.getElementById('newCatInput').value = '';
  renderAdmin();
  showToast('បន្ថែមប្រភេទ: ' + v, 'success');
};
function renderAdminTabs() {
  document.getElementById('adminTabs').innerHTML = ['ទាំងអស់',...categories].map(c =>
    `<button class="admin-tab ${activeTab===c?'active':''}" onclick="window.setAdminTab('${c}')">${c}</button>`
  ).join('');
}
window.setAdminTab = function(c) { activeTab=c; renderAdminTabs(); renderAdminGrid(); };

function renderAdminGrid() {
  const filtered = activeTab==='ទាំងអស់' ? items : items.filter(i => i.category===activeTab);
  const g = document.getElementById('adminGrid');
  g.innerHTML = filtered.map(item => {
    const imgSection = item.img
      ? `<div class="a-card-img-wrap" id="wrap-${item.firebaseId}" onclick="window.triggerCardImg('${item.firebaseId}')">
           <img src="${item.img}" alt="${item.name}">
           <div class="a-img-overlay">
             <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/></svg>
             <span>ផ្លាស់ប្ដូររូប</span>
           </div>
           <svg class="upload-ring"><circle cx="18" cy="18" r="14"/></svg>
         </div>`
      : `<div class="a-card-no-img" id="wrap-${item.firebaseId}" onclick="window.triggerCardImg('${item.firebaseId}')">
           <svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/></svg>
           <span>Upload រូបភាព</span>
         </div>`;
    return `<div class="a-card">
      ${imgSection}
      <div class="a-card-body">
        <div class="a-card-cat">${item.category}</div>
        <div class="a-card-name">${item.name}</div>
        <div class="a-card-desc">${item.desc||''}</div>
        <div class="a-card-foot">
          <div class="a-card-price">${item.price}</div>
          <div class="a-card-actions">
            <button class="a-icon-btn" onclick="window.openEditItem('${item.firebaseId}')">✎</button>
            <button class="a-icon-btn del" onclick="window.quickDelete('${item.firebaseId}')">✕</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('') + `<button class="a-add-card" onclick="window.openAddItem()">
    <svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
    <span>ADD ITEM</span>
  </button>`;
}

// ── CARD IMAGE UPLOAD (separate file input) ─────
window.triggerCardImg = function(firebaseId) {
  cardUploadFirebaseId = firebaseId;
  document.getElementById('cardFileInput').click();
};
document.getElementById('cardFileInput').addEventListener('change', async function(e) {
  const file = e.target.files[0];
  if (!file || !cardUploadFirebaseId) return;
  const wrap = document.getElementById('wrap-' + cardUploadFirebaseId);
  if (wrap) wrap.classList.add('uploading');
  showToast('កំពុង Upload រូបភាព...');
  const url = await uploadImage(file);
  if (url) {
    await updateDoc(doc(db, 'menuItems', cardUploadFirebaseId), { img: url });
    await loadItems();
    renderAdminGrid();
    renderCustomerGrid(activeTab);
    showToast('Upload រូបភាពជោគជ័យ! ✓', 'success');
  }
  if (wrap) wrap.classList.remove('uploading');
  cardUploadFirebaseId = null;
  this.value = '';
});

// Wire the helper `your-file-input` to `handleImageUploadAndSave` using a fixed document ID
const yourFileInput = document.getElementById('your-file-input');
if (yourFileInput) {
  yourFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const activeDocId = '6tMbV0iz2LgsTpwMUKVD'; // replace with dynamic id if needed
    await handleImageUploadAndSave(file, activeDocId);
    yourFileInput.value = '';
  });
}

// ── MODAL IMAGE UPLOAD ──────────────────────────
const imgDropZone = document.getElementById('imgDropZone');
const modalFileInput = document.getElementById('modalFileInput');

// Click to pick file
imgDropZone.addEventListener('click', () => modalFileInput.click());

// Drag & drop
imgDropZone.addEventListener('dragover', e => { e.preventDefault(); imgDropZone.classList.add('dragover'); });
imgDropZone.addEventListener('dragleave', () => imgDropZone.classList.remove('dragover'));
imgDropZone.addEventListener('drop', e => {
  e.preventDefault();
  imgDropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handleModalImgFile(file);
});

modalFileInput.addEventListener('change', function() {
  const file = this.files[0];
  if (file) handleModalImgFile(file);
  this.value = '';
});

function handleModalImgFile(file) {
  if (file.size > 5 * 1024 * 1024) { showToast('រូបភាពធំពេក — max 5MB', 'error'); return; }
  pendingImgFile = file;
  // Show preview immediately
  const reader = new FileReader();
  reader.onload = ev => {
    pendingImgPreview = ev.target.result;
    imgDropZone.innerHTML = `<img src="${pendingImgPreview}" style="border-radius:18px;"><div class="drop-hint" style="position:absolute;bottom:8px;left:0;right:0;background:rgba(6,11,22,.7);padding:4px;font-size:.75rem;color:var(--muted);">ចុចម្ដងទៀតដើម្បីផ្លាស់ប្ដូរ</div>`;
    imgDropZone.classList.add('has-img');
  };
  reader.readAsDataURL(file);
}

function resetModalImg() {
  pendingImgFile = null;
  pendingImgPreview = null;
  imgDropZone.innerHTML = `<div class="drop-hint">
    <svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/></svg>
    <span>ចុច ឬ Drag &amp; Drop រូបភាព</span>
    <span style="font-size:.78rem;opacity:.6;">JPG, PNG, WEBP — max 5MB</span>
  </div><div class="upload-bar" id="modalUploadBar"></div>`;
  imgDropZone.classList.remove('has-img');
}

// ── MODAL OPEN/CLOSE ────────────────────────────
function populateCatSelect(sel) {
  document.getElementById('fCat').innerHTML = categories.map(c =>
    `<option value="${c}" ${c===sel?'selected':''}>${c}</option>`
  ).join('');
}
window.openAddItem = function() {
  editingFirebaseId = null;
  resetModalImg();
  document.getElementById('modalTitle').textContent = 'ADD ITEM';
  document.getElementById('fName').value = '';
  document.getElementById('fDesc').value = '';
  document.getElementById('fPrice').value = '';
  populateCatSelect(categories[0]||'');
  document.getElementById('modalDelBtn').style.display = 'none';
  document.getElementById('modalOverlay').classList.add('open');
};
window.openEditItem = function(firebaseId) {
  const item = items.find(i => i.firebaseId === firebaseId);
  if (!item) return;
  editingFirebaseId = firebaseId;
  pendingImgFile = null;
  pendingImgPreview = item.img || null;
  document.getElementById('modalTitle').textContent = 'EDIT ITEM';
  document.getElementById('fName').value = item.name;
  document.getElementById('fDesc').value = item.desc||'';
  document.getElementById('fPrice').value = item.price;
  populateCatSelect(item.category);
  if (item.img) {
    imgDropZone.innerHTML = `<img src="${item.img}" style="border-radius:18px;"><div class="drop-hint" style="position:absolute;bottom:8px;left:0;right:0;background:rgba(6,11,22,.7);padding:4px;font-size:.75rem;color:var(--muted);">ចុចដើម្បីផ្លាស់ប្ដូររូប</div>`;
    imgDropZone.classList.add('has-img');
  } else {
    resetModalImg();
  }
  document.getElementById('modalDelBtn').style.display = 'inline-block';
  document.getElementById('modalOverlay').classList.add('open');
};
window.closeModal = function() {
  document.getElementById('modalOverlay').classList.remove('open');
  editingFirebaseId = null;
  pendingImgFile = null;
  pendingImgPreview = null;
};

// ── SAVE ITEM ───────────────────────────────────
window.saveItem = async function() {
  const name = document.getElementById('fName').value.trim();
  const desc = document.getElementById('fDesc').value.trim();
  const price = document.getElementById('fPrice').value.trim();
  const cat = document.getElementById('fCat').value;
  if (!name || !price) { showToast('សូមបំពេញឈ្មោះ និងតម្លៃ', 'error'); return; }

  const saveBtn = document.getElementById('modalSaveBtn');
  saveBtn.textContent = 'SAVING...';
  saveBtn.disabled = true;

  try {
    // Upload new image if picked
    let imgUrl = pendingImgPreview; // existing URL or null
    if (pendingImgFile) {
      showToast('កំពុង Upload រូបភាព...');
      imgUrl = await uploadImage(pendingImgFile);
      if (!imgUrl && pendingImgPreview && pendingImgPreview.startsWith('http')) {
        imgUrl = pendingImgPreview; // fallback to old url
      }
    }

    const data = { name, desc, price, category: cat, img: imgUrl || null };

    if (editingFirebaseId) {
      await updateDoc(doc(db, 'menuItems', editingFirebaseId), data);
      showToast('រក្សាទុករួចរាល់ ✓', 'success');
    } else {
      await addDoc(collection(db, 'menuItems'), data);
      showToast('បន្ថែមម្ហូបថ្មីរួចរាល់ ✓', 'success');
    }
    await loadItems();
    window.closeModal();
    renderAdminTabs();
    renderAdminGrid();
    renderCustomerGrid(activeTab);
  } catch(e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    saveBtn.textContent = 'SAVE';
    saveBtn.disabled = false;
  }
};

// ── DELETE ──────────────────────────────────────
window.deleteCurrentItem = async function() {
  if (!editingFirebaseId) return;
  if (!confirm('លុបម្ហូបនេះ?')) return;
  await deleteDoc(doc(db, 'menuItems', editingFirebaseId));
  await loadItems();
  window.closeModal();
  renderAdminTabs();
  renderAdminGrid();
  renderCustomerGrid(activeTab);
  showToast('លុបរួចរាល់');
};
window.quickDelete = async function(firebaseId) {
  if (!confirm('លុបម្ហូបនេះ?')) return;
  await deleteDoc(doc(db, 'menuItems', firebaseId));
  await loadItems();
  renderAdminTabs();
  renderAdminGrid();
  renderCustomerGrid(activeTab);
  showToast('លុបរួចរាល់');
};

// ── INIT ────────────────────────────────────────
async function init() {
  setLoading(true);
  try {
    await loadCategories();
    await loadItems();
  } catch(e) {
    showToast(' មានបញ្ហាតភ្ជាប់ Firebase', 'error');
  }
  setLoading(false);
  showCustomer();
}
init();