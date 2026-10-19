let zip = null;
let opfPath = '';
let opfDoc = null;
let newCoverArrayBuffer = null;
let newCoverMime = 'image/jpeg';
let originalFileName = '';
let ncxPath = ''; 
let currentSearchResults = []; 

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');

dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('border-blue-500'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('border-blue-500'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('border-blue-500');
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

async function handleFile(file) {
  if (!file || !file.name.endsWith('.epub')) {
    alert('Por favor selecciona un archivo .epub válido.');
    return;
  }

  originalFileName = file.name;
  updateStatus('Cargando ePub...');
  
  try {
    zip = new JSZip();
    const contents = await zip.loadAsync(file);

    const containerXml = await contents.file("META-INF/container.xml").async("text");
    const parser = new DOMParser();
    const containerDoc = parser.parseFromString(containerXml, "text/xml");
    const rootfile = containerDoc.querySelector("rootfile");
    opfPath = rootfile ? rootfile.getAttribute("full-path") : "content.opf";

    const opfXml = await contents.file(opfPath).async("text");
    opfDoc = parser.parseFromString(opfXml, "text/xml");

    const tocItem = opfDoc.querySelector('item[id="ncx"]') || opfDoc.querySelector('item[media-type="application/x-dtbncx+xml"]');
    if (tocItem) {
        const href = tocItem.getAttribute('href');
        const folder = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
        ncxPath = folder + href;
    }

    const title = getOpfValue("title");
    const author = getOpfValue("creator");
    const publisher = getOpfValue("publisher");
    const language = getOpfValue("language") || "es";
    let isbn = getOpfValue("identifier");
    const description = getOpfValue("description");

    const cleanIsbnCheck = isbn.replace(/[^0-9X]/gi, '');
    if (cleanIsbnCheck.length < 10) isbn = ""; 

    document.getElementById('input-title').value = title;
    document.getElementById('input-author').value = author;
    document.getElementById('input-publisher').value = publisher;
    document.getElementById('input-language').value = language;
    document.getElementById('input-isbn').value = isbn;
    
    let tmp = document.createElement("div");
    tmp.innerHTML = description;
    document.getElementById('input-description').value = tmp.textContent || tmp.innerText || "";

    await extractCurrentCover(contents);

    document.getElementById('editor-view').classList.remove('hidden');
    document.getElementById('btn-download').classList.remove('hidden');
    document.getElementById('btn-preview').classList.remove('hidden'); // Boton ojear texto
    updateStatus('ePub cargado. Listo para buscar.');

    document.getElementById('suggested-content').classList.add('hidden');
    
    searchDualEngines(title, author, isbn);

  } catch (err) {
    console.error(err);
    alert('Error al procesar el ePub. Archivo corrupto o encriptado (DRM).');
    updateStatus('Error de lectura');
  }
}

function getOpfValue(tag) {
  if (!opfDoc) return "";
  const el = opfDoc.querySelector(`dc\\:${tag}`) || opfDoc.querySelector(tag) || opfDoc.getElementsByTagNameNS('*', tag)[0];
  return el ? el.textContent.trim() : "";
}

async function extractCurrentCover(zipInstance) {
  const folder = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
  let coverHref = null;

  const metaCover = opfDoc.querySelector('meta[name="cover"]');
  if (metaCover) {
    const coverId = metaCover.getAttribute('content');
    const item = opfDoc.querySelector(`item[id="${coverId}"]`);
    if (item) coverHref = item.getAttribute('href');
  }
  if (!coverHref) {
    const item = opfDoc.querySelector('item[properties~="cover-image"]') || opfDoc.querySelector('item[id*="cover"]');
    if (item) coverHref = item.getAttribute('href');
  }

  const coverImg = document.getElementById('current-cover');
  const noCoverText = document.getElementById('no-cover-text');

  if (coverHref) {
    const fullPath = folder + coverHref;
    const file = zipInstance.file(fullPath) || zipInstance.file(coverHref);
    if (file) {
      const blob = await file.async('blob');
      coverImg.src = URL.createObjectURL(blob);
      coverImg.classList.remove('hidden');
      noCoverText.classList.add('hidden');
      return;
    }
  }
  coverImg.classList.add('hidden');
  noCoverText.classList.remove('hidden');
}

// 📖 NUEVO: EXTRAER Y MOSTRAR TEXTO DEL EPUB
async function openPreview() {
  const modal = document.getElementById('preview-modal');
  const textContainer = document.getElementById('preview-text');
  modal.classList.remove('hidden');
  
  // Animación suave
  setTimeout(() => {
    modal.classList.remove('opacity-0');
    document.getElementById('preview-modal-content').classList.remove('scale-95');
  }, 10);

  textContainer.innerHTML = '<div class="text-center text-slate-500 py-10">Procesando texto del libro...</div>';

  try {
    const folder = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
    const spineItems = opfDoc.querySelectorAll('spine itemref');
    const manifest = opfDoc.querySelector('manifest');
    
    let htmlContent = '';
    let extractedCount = 0;

    // Buscar y leer los primeros 4 capítulos (ignorando portadas vacías)
    for (let i = 0; i < spineItems.length; i++) {
      if (extractedCount >= 4) break;
      
      const idref = spineItems[i].getAttribute('idref');
      const item = manifest.querySelector(`item[id="${idref}"]`);
      
      if (item) {
        const fullPath = folder + item.getAttribute('href');
        const file = zip.file(fullPath);
        if (file) {
          const content = await file.async("text");
          const parser = new DOMParser();
          const doc = parser.parseFromString(content, "text/html");
          
          // Extraer solo texto puro para evitar romper la interfaz con el CSS del libro
          const text = doc.body.innerText.trim();
          
          if (text.length > 200) { // Ignorar páginas vacías o solo con títulos
            htmlContent += `<div class="mb-8 border-b border-slate-800 pb-8"><h4 class="text-emerald-500 font-bold mb-4 font-sans text-xs tracking-widest uppercase">Extracto ${extractedCount + 1}</h4><p class="whitespace-pre-wrap">${text.substring(0, 3500)}...</p></div>`;
            extractedCount++;
          }
        }
      }
    }

    textContainer.innerHTML = htmlContent || 'No se pudo extraer texto legible. Puede ser un PDF escaneado o tener DRM.';

  } catch (err) {
    textContainer.innerHTML = 'Error al leer el archivo. El formato interno es inusual.';
  }
}

function closePreview() {
  const modal = document.getElementById('preview-modal');
  modal.classList.add('opacity-0');
  document.getElementById('preview-modal-content').classList.add('scale-95');
  setTimeout(() => {
    modal.classList.add('hidden');
  }, 300);
}


// MOTOR DUAL: GOOGLE BOOKS + APPLE BOOKS MEXICO
async function searchDualEngines(title, author, isbnStr) {
  const rightPanel = document.getElementById('suggested-content');
  rightPanel.innerHTML = ''; 
  
  document.getElementById('suggested-empty').classList.add('hidden');
  rightPanel.classList.add('hidden');
  document.getElementById('suggested-loading').classList.remove('hidden');
  updateStatus('Buscando en Apple Books y Google Books (México)...');

  const cleanIsbnCheck = isbnStr.replace(/[^0-9X]/gi, '');
  const cleanTitle = title.replace(/\(.*\)/g, '').split(':')[0].trim();
  const query = `${cleanTitle} ${author}`.trim();
  
  let validBooks = [];

  try {
    let gbUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&country=MX&langRestrict=es&maxResults=5`;
    if (cleanIsbnCheck.length >= 10 && cleanIsbnCheck.length <= 13) {
      gbUrl = `https://www.googleapis.com/books/v1/volumes?q=isbn:${cleanIsbnCheck}&country=MX`;
    }
    const gbRes = await fetch(gbUrl);
    if (gbRes.ok) {
        const data = await gbRes.json();
        const items = data.items || (data.volumeInfo ? [data] : []);
        items.forEach(item => {
            const info = item.volumeInfo || item;
            const isbnObj = info.industryIdentifiers ? info.industryIdentifiers.find(i => i.type.includes('ISBN')) : null;
            if (isbnObj) {
                let cover = '';
                if (info.imageLinks) {
                    cover = info.imageLinks.extraLarge || info.imageLinks.large || info.imageLinks.medium || info.imageLinks.thumbnail;
                    cover = cover.replace('http://', 'https://').replace('&edge=curl', '').replace('zoom=1', 'zoom=0');
                }
                validBooks.push({
                    source: 'Google',
                    title: info.title || '',
                    authors: info.authors || [],
                    publisher: info.publisher || 'Desconocida',
                    isbn: isbnObj.identifier,
                    description: info.description || 'Sin sinopsis.',
                    coverUrl: cover,
                    year: info.publishedDate ? info.publishedDate.substring(0,4) : 'N/A'
                });
            }
        });
    }
  } catch (e) {}

  try {
      const appleUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=ebook&country=MX&limit=6`;
      const appleRes = await fetch(appleUrl);
      if (appleRes.ok) {
          const appleData = await appleRes.json();
          if (appleData.results) {
              appleData.results.forEach(book => {
                  let htmlDesc = book.description || 'Sin sinopsis.';
                  let doc = new DOMParser().parseFromString(htmlDesc, 'text/html');
                  let plainDesc = doc.body.textContent || "";

                  validBooks.push({
                     source: 'Apple',
                     title: book.trackName,
                     authors: [book.artistName],
                     publisher: 'Edición Digital MX',
                     isbn: 'APPLE-' + book.trackId,
                     description: plainDesc,
                     coverUrl: book.artworkUrl100 ? book.artworkUrl100.replace('100x100bb', '1000x1000bb') : '', 
                     year: book.releaseDate ? book.releaseDate.substring(0,4) : 'N/A'
                  });
              });
          }
      }
  } catch(e) {}

  document.getElementById('suggested-loading').classList.add('hidden');

  if (validBooks.length > 0) {
      let uniqueBooks = [];
      let titlesSeen = new Set();
      validBooks.forEach(b => {
          let t = b.title.toLowerCase().trim();
          if (!titlesSeen.has(t)) {
              titlesSeen.add(t);
              uniqueBooks.push(b);
          } else if (b.source === 'Apple' && b.coverUrl) {
              let idx = uniqueBooks.findIndex(ub => ub.title.toLowerCase().trim() === t);
              if (idx !== -1) uniqueBooks[idx] = b;
          }
      });

      currentSearchResults = uniqueBooks.slice(0, 8);
      renderMultiResults(currentSearchResults); 
  } else {
      showSuggestedError('Ningún servidor encontró el libro. Borra el ISBN y el Autor, deja solo el título principal y presiona Re-buscar.');
  }
}

function renderMultiResults(books) {
  const rightPanel = document.getElementById('suggested-content');
  rightPanel.innerHTML = '<h3 class="text-sm font-bold text-slate-300 mb-4 border-b border-slate-700 pb-2">Selecciona la edición mexicana correcta:</h3>';
  rightPanel.className = "space-y-4 overflow-y-auto max-h-[500px] pr-2";
  
  books.forEach((book, index) => {
    const badgeColor = book.source === 'Apple' ? 'bg-blue-900/50 text-blue-300 border-blue-700' : 'bg-emerald-900/50 text-emerald-300 border-emerald-700';

    const card = document.createElement('div');
    card.className = "flex bg-slate-900/80 border border-slate-700 rounded-xl p-3 hover:border-blue-500 transition-colors gap-4 items-center";
    
    card.innerHTML = `
      <div class="w-16 h-24 bg-slate-800 rounded flex-shrink-0 flex items-center justify-center overflow-hidden border border-slate-700 shadow-md">
        ${book.coverUrl ? `<img src="${book.coverUrl.replace('http://', 'https://')}" class="w-full h-full object-cover">` : `<span class="text-[10px] text-slate-500 text-center px-1">Sin img</span>`}
      </div>
      <div class="flex-grow text-xs space-y-1">
        <div class="flex justify-between items-start">
            <p class="font-bold text-slate-200 text-sm truncate w-36 sm:w-48" title="${book.title}">${book.title}</p>
            <span class="text-[9px] px-1.5 py-0.5 rounded border font-semibold ${badgeColor}">${book.source}</span>
        </div>
        <p class="text-slate-400">Ed: <span class="text-emerald-400 font-semibold">${book.publisher}</span></p>
        <p class="text-slate-400">Año: <span class="text-slate-300">${book.year}</span> | Idioma: <span class="text-slate-300">ES</span></p>
        <p class="text-slate-400">ISBN: <span class="text-blue-300 font-mono">${book.isbn}</span></p>
      </div>
      <button onclick='selectEdition(${index})' class="bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-2 rounded-lg font-medium transition-all shrink-0 shadow-lg">
        Elegir
      </button>
    `;
    rightPanel.appendChild(card);
  });
  
  rightPanel.classList.remove('hidden');
}

async function selectEdition(index) {
    const bookData = currentSearchResults[index];
    
    document.getElementById('input-title').value = bookData.title;
    document.getElementById('input-author').value = bookData.authors.join(', ');
    document.getElementById('input-publisher').value = bookData.publisher;
    document.getElementById('input-isbn').value = bookData.isbn;
    document.getElementById('input-language').value = 'es';
    document.getElementById('input-description').value = bookData.description;

    if (bookData.coverUrl) {
        try {
            updateStatus('Descargando portada oficial Ultra HD...');
            const response = await fetch(bookData.coverUrl);
            newCoverArrayBuffer = await response.arrayBuffer();
            newCoverMime = response.headers.get('content-type') || 'image/jpeg';
      
            const blob = new Blob([newCoverArrayBuffer], { type: newCoverMime });
            const currentCoverImg = document.getElementById('current-cover');
            currentCoverImg.src = URL.createObjectURL(blob);
            currentCoverImg.classList.remove('hidden');
            document.getElementById('no-cover-text').classList.add('hidden');
            
            updateStatus('¡Metadatos y portada HD aplicados! Listo para descargar.');
          } catch (e) {
            updateStatus('¡Metadatos aplicados! (La descarga de portada fue bloqueada)');
          }
    } else {
        updateStatus('¡Metadatos aplicados! (Esta edición no tiene portada)');
    }
}

function showSuggestedError(msg) {
  const empty = document.getElementById('suggested-empty');
  empty.innerText = msg;
  empty.classList.remove('hidden');
}

function reSearchGoogle() {
  const t = document.getElementById('input-title').value;
  const a = document.getElementById('input-author').value;
  const i = document.getElementById('input-isbn').value;
  searchDualEngines(t, a, i);
}

// DESCARGA
async function downloadEpub() {
  if (!zip || !opfDoc) return;

  updateStatus('Generando ePub...');

  const setOrUpdateTag = (tag, val) => {
    let el = opfDoc.querySelector(`dc\\:${tag}`) || opfDoc.querySelector(tag) || opfDoc.getElementsByTagNameNS('*', tag)[0];
    if (el) {
      el.textContent = val;
    } else {
      const metadata = opfDoc.querySelector('metadata') || opfDoc.getElementsByTagNameNS('*', 'metadata')[0];
      if (metadata) {
        const newEl = opfDoc.createElementNS('http://purl.org/dc/elements/1.1/', `dc:${tag}`);
        newEl.textContent = val;
        metadata.appendChild(newEl);
      }
    }
  };

  const newIsbn = document.getElementById('input-isbn').value;
  
  setOrUpdateTag('title', document.getElementById('input-title').value);
  setOrUpdateTag('creator', document.getElementById('input-author').value);
  setOrUpdateTag('publisher', document.getElementById('input-publisher').value);
  setOrUpdateTag('language', document.getElementById('input-language').value);
  
  let uniqueId = newIsbn;
  if (uniqueId.startsWith('APPLE-')) {
      uniqueId = "urn:uuid:" + uniqueId;
  } else {
      uniqueId = "urn:isbn:" + newIsbn;
  }
  setOrUpdateTag('identifier', uniqueId);
  
  if (ncxPath) {
      try {
          const ncxXml = await zip.file(ncxPath).async("text");
          const parser = new DOMParser();
          const ncxDoc = parser.parseFromString(ncxXml, "text/xml");
          
          let dtbUid = ncxDoc.querySelector('meta[name="dtb:uid"]');
          if (dtbUid) {
              dtbUid.setAttribute('content', uniqueId);
              const serializer = new XMLSerializer();
              zip.file(ncxPath, serializer.serializeToString(ncxDoc));
          }
      } catch (e) {}
  }

  let descEl = opfDoc.querySelector(`dc\\:description`) || opfDoc.querySelector('description') || opfDoc.getElementsByTagNameNS('*', 'description')[0];
  if (descEl) {
    descEl.innerHTML = document.getElementById('input-description').value;
  } else {
    setOrUpdateTag('description', document.getElementById('input-description').value);
  }

  if (newCoverArrayBuffer) {
    const ext = newCoverMime.includes('png') ? 'png' : 'jpg';
    const folder = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
    const newCoverFileName = `cover_oficial.${ext}`;
    const newCoverFullPath = folder + newCoverFileName;

    zip.file(newCoverFullPath, newCoverArrayBuffer);

    let item = opfDoc.querySelector('item[properties~="cover-image"]') || opfDoc.querySelector('item[id="cover-image"]');
    if (item) {
      item.setAttribute('href', newCoverFileName);
      item.setAttribute('media-type', newCoverMime);
    } else {
      const manifest = opfDoc.querySelector('manifest') || opfDoc.getElementsByTagNameNS('*', 'manifest')[0];
      if (manifest) {
        const newItem = opfDoc.createElement('item');
        newItem.setAttribute('id', 'cover-image');
        newItem.setAttribute('href', newCoverFileName);
        newItem.setAttribute('media-type', newCoverMime);
        newItem.setAttribute('properties', 'cover-image');
        manifest.appendChild(newItem);
      }
    }
  }

  const serializer = new XMLSerializer();
  const updatedOpfXml = serializer.serializeToString(opfDoc);
  zip.file(opfPath, updatedOpfXml);

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE'
  });

  const finalTitle = document.getElementById('input-title').value || 'Libro_Oficial';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${finalTitle.replace(/[/\\?%*:|"<>]/g, '_')}.epub`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  updateStatus('¡ePub descargado!');
}

function updateStatus(msg) {
  document.getElementById('status-badge').innerText = msg;
}