# Branding Cloud

## Identidad

MONZO es el nombre de la plataforma y de la mascota oficial. Dirección luminosa y minimalista: fondos claros, espacios amplios, superficies suaves, acentos turquesa y una presencia humana de la mascota. No se inventaron clientes, testimonios ni métricas.

Tokens en `src/app/globals.css`: turquesa principal `#29C7C9`, turquesa oscuro `#0D7C86`, azul petróleo `#17222B`, fondo `#F8FBFC`, blanco `#FFFFFF`, gris secundario `#6E7E8D`. Inter Variable se sirve localmente. Se definen tokens semánticos compatibles con shadcn/ui, radio `.875rem`, sombra suave y espaciado de sección. Estados de foco visibles, hover, disabled y selección. La animación de la mascota respeta `prefers-reduced-motion`.

## Archivos originales y extracción

`assets/brand/originals/monzo-mascot-reactions.pdf` conserva exactamente el PDF recibido. El PDF contiene una página y 20 imágenes con máscaras de transparencia. Se extrajeron con Poppler `pdfimages -png`, se recombinó cada imagen con su propia máscara usando Pillow y se exportó WebP lossless. No se redibujó, recortó ni recoloreó la mascota. Su resolución original es aproximadamente 255–348 px de ancho: las pantallas de alta densidad y tamaños superiores pueden mostrar suavidad; no se generaron detalles artificiales.

El favicon usa la reacción welcome original, reducida proporcionalmente y centrada sobre el fondo Cloud. `Mascot` encapsula Next Image y permite `reaction`, `size`, `priority` y `decorative`. Se usan welcome en hero, wink en cierre y support en dashboard. Dimensiones intrínsecas, carga diferida fuera del hero y optimización de Next Image reducen cambios de layout. Las imágenes decorativas tienen alt vacío.

| Índice original (orden de extracción) | Reacción                                     |
| ------------------------------------- | -------------------------------------------- |
| 01–05                                 | welcome, wink, working, phone, love          |
| 06–10                                 | happy, sparkle, idea, checklist, thinking    |
| 11–15                                 | sleeping, hearts, surprised, cool, angry     |
| 16–20                                 | celebrating, pointing, growth, support, time |

Los nombres describen gestos para selección interna; no alteran las ilustraciones.

## Logo oficial integrado

El segundo PDF recibido contiene el logo en vectores, no una imagen rasterizada. El original se conserva sin cambios en `assets/brand/originals/monzo-logo.pdf`. Se exportó directamente con Poppler:

```sh
pdftocairo -svg assets/brand/originals/monzo-logo.pdf public/brand/logo/monzo-light.svg
```

El SVG contiene únicamente los trazados del diseño, con transparencia, sin scripts, fuentes externas ni imágenes enlazadas. No se trazó a mano ni se usó generación de imágenes: se mantienen las formas, colores y proporciones del PDF. La página original mide 999.2556 × 166.4262; el viewBox conserva esa relación de aspecto.

`Logo` utiliza Next Image con SVG servido directamente (`unoptimized`) y un enlace accesible a inicio. Sustituye el identificador textual provisional en el header, footer y sidebar. Una superficie petróleo alrededor del recurso permite usar las letras claras sobre la interfaz Cloud sin recolorear el logo ni modificar el archivo. El tamaño se adapta a móvil; no se recorta ni se estira el diseño.

No hay avatares o mascotas genéricas sustituyendo los originales. Los iconos Lucide se usan exclusivamente para interfaz.
