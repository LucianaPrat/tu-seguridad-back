# Detección de personas — hallazgos de medición

**Para:** equipo de face-auth
**De:** equipo de tu-seguridad (backend)
**Fecha de la medición:** 2026-09-02
**Endpoint bajo análisis:** `POST https://api.face-auth.me/api/v1/persons`

---

## 1. Resumen

Integramos `/api/v1/persons` en un sistema de alerta perimetral: ocho canales de un grabador
analógico, un frame por cámara cada 15 s, y una alerta cuando aparece una persona. En producción el
sistema **no alerta**, y la medición apunta al detector, no a nuestra integración.

Sobre 35 imágenes con presencia de persona verificada a ojo, más una muestra en vivo de 33 frames:

- **0 de 11** detecciones en frames donde hay una persona claramente visible a distancia media
  (sujeto ocupando ~7% del ancho del frame).
- **1 de 33** en una muestra nocturna continua con una persona parada en escena todo el tiempo.
- **6 de 8** en frames diurnos con el sujeto cerca de la cámara — ahí sí funciona bien.
- **0 falsos positivos** en 5 frames de escena vacía. La precisión no es el problema; el recall sí.
- **Todas las fallas devuelven `persons: []`** — array vacío, nunca un score bajo. Esto es lo que nos
  deja sin margen de acción: no hay nada que podamos dejar pasar bajando un umbral.

Nuestra hipótesis principal, y la razón número uno de este documento: **sospechamos que el servicio
aplica un umbral propio antes de responder.** Un detector que no encuentra a la persona debería
devolver detecciones de score bajo, no un array vacío. Si ese corte existe y es configurable, buena
parte de lo que sigue se resuelve con un parámetro.

---

## 2. Método

Para que sea auditable de su lado:

1. Frame capturado directo del grabador vía ISAPI (`/ISAPI/Streaming/channels/{canal}01/picture`),
   JPEG, 704×576, sin ningún pre-proceso nuestro.
2. Sesión obtenida con `POST /api/v1/auth/authorize` (header `Fa-Client-Token`), y el token
   devuelto enviado como `Fa-Token` junto a `Fa-Domain`.
3. `POST /api/v1/persons`, multipart, campo `file`.
4. Registramos el `persons[]` **crudo** de la respuesta, antes de cualquier filtro nuestro. Los
   números de este documento no pasan por nuestro umbral de 0.45.
5. Verdad de referencia establecida mirando cada imagen.
6. Espaciado de 12 s entre requests para no activar el límite de tasa (ver H6). 0 errores de
   upstream en toda la corrida.

---

## 3. Hallazgos

### H1 — El recall depende del tamaño del sujeto en el frame

| Conjunto | Verdad | Detecta | Tasa |
|---|---|---|---|
| Cámara patio, sujeto cerca, luz de día | persona | 6/8 | **75%** |
| Cámara a la calle, sujeto lejos (~7% del ancho) | persona | 0/8 | **0%** |
| Cámara a jardín/calle, sujeto lejos | persona | 0/3 | **0%** |
| Escenas vacías | vacío | 0/5 | 0% falsos positivos |

Todas las detecciones que sí ocurrieron caen en el rango **0.514 – 0.779**. Nunca vimos un score
por encima de 0.779, en ninguna imagen, ni en las más favorables.

En el caso de la cámara a la calle, el sujeto mide aproximadamente **40×100 px sobre 704×576**. Esa
misma escena produjo una única detección histórica, con score 0.50.

### H2 — Reescalar la imagen no cambia nada

Tomamos el frame que falla y lo subimos a 2× y 3× (704 → 1408 → 2112 px de ancho, JPEG q90):
**0 detecciones en ambos**. No parece haber un piso de resolución mínima que se pueda superar
interpolando; el modelo no dispara con esas figuras.

Nota importante de nuestro lado: **no podemos mandar imágenes más grandes.** Son canales analógicos
sobre un grabador Hikvision DVR-208G-M1; 704×576 (D1 PAL) es el techo del stream principal. Si la
recomendación fuera subir resolución de entrada, necesitaríamos saberlo para plantear un cambio de
hardware al cliente.

### H3 — El servicio es determinístico (esto es una buena noticia)

| Imagen | Corridas | Resultado |
|---|---|---|
| Patio, día, sujeto en la puerta | 4 | `0.625` las cuatro |
| Calle, día, sujeto en la vereda | 4 | `0` las cuatro |
| Patio, noche, sujeto de frente a la luz | 2 | `0.558` las dos |

Bytes idénticos devuelven el mismo score hasta la tercera decimal. O sea que **cualquier frame que
les mandemos es un caso reproducible**, y también que reintentar el mismo frame no sirve de nada.

### H4 — Con imagen monocroma la detección se cae a cero

Este es el hallazgo más accionable. Partimos del frame que el servicio puntúa mejor (0.625) y lo
fuimos degradando de a una variable:

| Variante | Score |
|---|---|
| original | 0.625 |
| brillo ×0.70 | 0.610 |
| brillo ×0.50 | 0.606 |
| desenfoque gaussiano σ=1 | 0.620 |
| desenfoque gaussiano σ=2 | 0.593 |
| reducido a 352×288 | 0.626 |
| **escala de grises** | **0** |
| grises ×0.99 / grises ×0.85 / grises + σ=1 | **0** las tres |
| JPEG calidad 15 | **0** |
| grises ×0.50 + σ=1 | 0.533 |

Lectura: el modelo es notablemente **robusto** a oscuridad, desenfoque y pérdida de resolución — el
score casi no se mueve. Y es **frágil** a la pérdida de color y a los artefactos JPEG fuertes.

Aclaración técnica: verificamos que todas las variantes salen como **JPEG sRGB de 3 canales**, así
que no es un rechazo por formato de píxel — es el contenido. La última fila contradice a las cuatro
anteriores, lo que sugiere que el margen de decisión en estas imágenes es muy angosto y no monótono
respecto de la calidad.

Esto importa porque **de noche nuestras cámaras entregan IR monocromo.** La misma escena que de día
puntúa 0.625, de noche no existe para el detector.

### H5 — Muestra nocturna en vivo

33 frames del mismo canal, uno cada ~3 s, con una persona parada en el patio durante toda la
ventana: **una sola detección**, `detScore 0.5584`. Revisamos cuatro de esos frames a ojo y en los
cuatro la persona está visible; solo el último puntuó. El frame que sí detectó es el único donde el
sujeto está **de frente y bajo la luz de la puerta**; en los demás está de espaldas o en sombra.

Un minuto después, con el sujeto mirando de frente a la cámara, el sistema alertó normalmente con
score 0.667. No es que la integración falle: el detector encuentra a la persona cuando hay cara
visible y luz, y no la encuentra en el resto de los casos.

### H6 — Límite de tasa: comportamiento y falta de documentación

- Con 250 ms entre requests, recibimos `429` después de ~17 requests, y luego una ventana de
  penalización: nuestros reintentos siguieron fallando durante 15–45 s.
- Con 12 s entre requests, 35 requests consecutivos sin un solo `429`.
- El ritmo normal de nuestro pipeline (5 cámaras activas, un frame cada 15 s ≈ un request cada 3 s)
  nunca lo activó.

Dos pedidos acá. Primero, **necesitamos el límite documentado** (requests por minuto, por IP o por
dominio, y si hay ráfaga permitida) para dimensionar herramientas de backfill y un segundo ambiente.
Segundo, **no vimos header `Retry-After`** en las respuestas 429. Sin él, un cliente no puede
distinguir "esperá 5 segundos" de "el servicio se cayó", y del lado nuestro un burst de 429 se
parece a una caída de upstream.

### H7 — Contrato de respuesta

Consumimos `persons[].detScore` y `persons[].anchor` (`{x, y}` normalizado), y transportamos
`bbox` / `bboxNorm` sin leerlos. Validamos en el borde que `detScore` y `anchor` sean numéricos y
rechazamos el body si no lo son, porque un campo renombrado llegaría como `undefined` y la cámara
dejaría de alertar en silencio. Solo queremos confirmar que esos dos campos son estables y que nos
avisarían de un cambio.

---

## 4. Qué descartamos de nuestro lado

Para que no vuelva como "revisen su integración", esto ya está medido:

| Sospecha | Estado | Evidencia |
|---|---|---|
| El polling se detuvo | Descartado | Contador de polls avanzando; ~2190 polls exitosos por cámara en 20 h |
| La captura del grabador falla | Descartado | ~2190 capturas exitosas por canal contra 1 error por canal |
| Nuestro umbral filtra las detecciones | Descartado | Los números de este documento son el `persons[]` crudo, sin filtrar |
| Nuestra lógica de confirmación pierde alertas | Descartado | El evento de las 19:33 confirmó y entregó normalmente, score 0.667 |
| Transporte o codificación de la imagen | Descartado | H3: mismo JPEG, mismo score; y los frames diurnos cercanos detectan bien |

---

## 5. Preguntas concretas

1. **¿Aplican un umbral de confianza propio antes de responder?** Si sí, ¿cuál es y se puede
   parametrizar por request o por dominio? Los arrays vacíos en lugar de scores bajos son nuestra
   principal pista de que existe.
2. **Modelo y versión detrás de `/api/v1/persons`**, y recall esperado para sujetos por debajo del
   10% del ancho del frame. ¿Hay un tamaño mínimo de sujeto documentado?
3. **¿Hay soporte para entrada monocroma / IR?** ¿Mismo modelo, pesos distintos, o algún
   pre-proceso recomendado de nuestro lado (pseudo-color, ecualización tipo CLAHE) antes de enviar?
4. **¿Existe algún parámetro de sensibilidad, tamaño mínimo o modo "devolver todo"** que podamos
   activar para filtrar nosotros en lugar de recibir el array vacío?
5. **Límite de tasa documentado** y si devuelven `Retry-After`. Si hay un endpoint batch o una
   cuota mayor para casos de video-vigilancia, nos interesa.
6. **Resolución de entrada recomendada.** Nuestro techo es 704×576 por hardware analógico (H2); si
   el modelo espera más, necesitamos saberlo para plantear el cambio.

---

## 6. Qué podemos entregar

- El conjunto de frames de la medición, con la verdad de referencia marcada — incluidos los pares
  "misma escena, detecta / no detecta" y las variantes de la escalera de degradación de H4. Son
  imágenes de un domicilio particular con personas identificables, así que las compartimos por
  canal privado y bajo el acuerdo que corresponda.
- El script de medición, para que reproduzcan la tabla del punto 3 con sus propios frames.
- Fecha, hora y `detScore` de cada request, si quieren cruzarlo con sus logs del 2026-09-02 entre
  las 19:30 y las 19:45 (hora de Argentina, UTC−3).

---

## 7. Anexo — datos crudos

Detecciones observadas, ordenadas por score: `0.779`, `0.677`, `0.667`, `0.626`, `0.625`, `0.620`,
`0.610`, `0.606`, `0.595`, `0.593`, `0.558`, `0.533`, `0.520`, `0.514`.

Todo el resto de las imágenes con persona presente devolvió `persons: []`.

Configuración del cliente durante la medición: un request por vez, sin concurrencia; timeout de
lectura holgado; sin reintento sobre la misma imagen; y un circuit breaker que abre al 50% de error
— relevante porque hoy un `429` cuenta como error de upstream y nos apaga la detección de todas las
cámaras por 30 s, algo que vamos a corregir de nuestro lado en cuanto sepamos la respuesta al
punto 5.
