# Memorias de Obra

App para el celular que registra medidas de campo **sin señal**, con fotos de soporte, y genera el Excel de **balance**, **acta parcial** o **corte a subcontratistas** con memorias de cálculo por ítem.

- Funciona sin internet: se instala en la pantalla del celular (Android y iPhone).
- Las medidas y fotos se guardan en el celular y se suben solas a Google Drive cuando vuelve la señal.
- Los datos del contrato (presupuesto, precios, medidas, fotos) quedan **solo en tu Google Drive**, no en este repositorio.

## Instalación (una sola vez)

1. Crea una hoja de cálculo nueva en Google Drive (por ejemplo `Memorias de obra - Contrato X`).
2. En la hoja: **Extensiones → Apps Script**. Borra lo que aparece y pega el contenido de [`servidor/Code.gs`](servidor/Code.gs).
3. Cambia `CAMBIA-ESTA-CLAVE` por una clave tuya y guarda.
4. Elige la función `probar` y toca **Ejecutar**; autoriza el acceso a tu Drive.
5. **Implementar → Nueva implementación → Aplicación web**. Ejecutar como: **Yo**. Quién tiene acceso: **Cualquier usuario**. Copia la URL que termina en `/exec`.
6. Abre la app, ve a **Ajustes**, pega la URL y la clave, y toca **Guardar conexión**.
7. En **Ajustes → Presupuesto**, elige el Excel del contrato (mejor desde un computador).
8. Copia el **enlace para tu personal** y envíalo por WhatsApp.

## Para el personal

1. Abrir el enlace que les enviaron (con señal, la primera vez).
2. Escribir su nombre.
3. Agregar a la pantalla de inicio:
   - **Android (Chrome):** menú ⋮ → *Agregar a la pantalla principal* / *Instalar app*.
   - **iPhone (Safari):** botón Compartir → *Agregar a inicio*.
4. Desde ahí la app abre aunque no haya señal.
