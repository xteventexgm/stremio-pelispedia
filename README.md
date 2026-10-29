# 🎬 PelisMaster - Stremio Addon (Español)

Addon de Stremio que realiza scraping directo a **PelisMaster / MovieMaster** para obtener enlaces de streaming nativos en formato **HLS (`.m3u8`)** en alta calidad (720p/1080p) con opciones en:
* 🇲🇽 **Español Latino**
* 🇪🇸 **Castellano**
* 💬 **Subtitulado**

Compatible con películas y series completas.

---

## 🚀 Características
* **Streams HLS nativos:** Carga instantánea, sin anuncios molestos ni ventanas emergentes.
* **Soporte de Películas y Series:** Mapeo automático de IMDb ID y temporadas/episodios.
* **Caché en memoria:** Evita peticiones repetitivas para máxima velocidad.
* **Arquitectura Modular:** Diseñado con carpeta `src/providers/` para sumar más webs (como PelisPlus o LaMovie) fácilmente.
* **Listo para Render:** Consumo ultra bajo de memoria (~50 MB RAM) con endpoint `/health` para mantenerlo despierto 24/7.

---

## 🛠️ Ejecución Local

1. Instala las dependencias:
```bash
npm install
```

2. Inicia el servidor:
```bash
npm start
```

3. Abre tu navegador en:
   * **Página de instalación:** [http://localhost:7000](http://localhost:7000)
   * **Manifiesto:** [http://localhost:7000/manifest.json](http://localhost:7000/manifest.json)

4. Para instalarlo en Stremio, copia el enlace del manifiesto o haz clic en el botón de la página de inicio.

---

## ☁️ Despliegue en Render (Paso a Paso - Gratis 24/7)

### 1. Subir a GitHub
1. Inicializa git en esta carpeta y sube el código a un repositorio privado o público en tu cuenta de GitHub:
```bash
git init
git add .
git commit -m "feat: PelisMaster stremio addon"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
git push -u origin main
```

### 2. Crear el Web Service en Render
1. Ve a [Render.com](https://render.com/) e inicia sesión con tu cuenta de GitHub.
2. Haz clic en **New +** y selecciona **Web Service**.
3. Selecciona el repositorio que acabas de subir.
4. Configura los siguientes campos:
   * **Name:** `pelismaster-stremio` (o el nombre que gustes)
   * **Language:** `Node`
   * **Branch:** `main`
   * **Build Command:** `npm install`
   * **Start Command:** `npm start`
   * **Instance Type:** `Free` (0.1 CPU, 512 MB RAM)
5. Haz clic en **Deploy Web Service**.

En 2 minutos Render te dará tu URL pública, por ejemplo:
`https://pelismaster-stremio.onrender.com`

---

## ⏰ Mantener el Addon Despierto 24/7 en Render

Para evitar que Render duerma tu addon tras 15 minutos de inactividad:

1. Crea una cuenta gratuita en [UptimeRobot](https://uptimerobot.com/) o [cron-job.org](https://cron-job.org/).
2. Añade un nuevo monitor:
   * **Monitor Type:** `HTTP(s)`
   * **Friendly Name:** `Stremio Addon Keep-Alive`
   * **URL:** `https://tu-servicio.onrender.com/health` (o `/manifest.json`)
   * **Monitoring Interval:** Cada `10 minutes`.
3. Guarda el monitor. ¡Listo! Tu addon estará activo 24/7 sin gastar nada.

---

## ➕ Cómo Instalarlo en tus Dispositivos Stremio

Una vez tengas tu URL de Render:
1. Abre Stremio (en tu PC, TV, Android o iPhone).
2. Ve a la sección **Addons** (icono de pieza de rompecabezas).
3. En la barra de búsqueda o en el campo "Addon URL", pega:
   ```
   https://tu-servicio.onrender.com/manifest.json
   ```
4. Haz clic en **Instalar** (Install).
5. ¡Disfruta de cualquier película o serie en español!

