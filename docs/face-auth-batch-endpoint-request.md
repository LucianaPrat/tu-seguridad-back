# Pedido de endpoint batch para `/api/v1/persons`

**Para:** equipo de face-auth
**De:** equipo de tu-seguridad (backend)
**Fecha:** 2026-09-09
**Endpoint actual:** `POST https://api.face-auth.me/api/v1/persons` — una imagen por request
**Continúa:** [`face-auth-detection-findings.md`](face-auth-detection-findings.md), §5.5

---

## 1. Resumen

Necesitamos analizar **varias imágenes en un mismo request**. Concretamente: entre 20 y 60 frames
consecutivos de la misma cámara, tomados de una ventana de 20 a 30 segundos de video.

Hoy eso son 20 a 60 requests separados. Con el límite de **1 request por segundo por IP**, un solo
evento consume entre 20 y 60 segundos del presupuesto total de nuestra integración —
que es compartido por las ocho cámaras, incluida la que en ese momento podría estar mirando a un
intruso en tiempo real.

El pedido es un endpoint que reciba N imágenes y devuelva N resultados.

---

## 2. Por qué lo necesitamos

En el documento anterior medimos que el recall depende fuertemente del tamaño y la pose del sujeto:
**0 de 11** detecciones a distancia media, **1 de 33** en una muestra nocturna con una persona
parada en escena todo el tiempo.

Nuestra reacción no es pedirles que el modelo mejore. Es **dejar de apostar todo a un solo frame**.

El grabador nos avisa cuando detecta movimiento, y graba en continuo. Medimos esto contra el equipo
real el 2026-09-09:

- El grabador publicó el evento de movimiento a las **23:11:27**.
- Recuperando su propia grabación de esos segundos, el sujeto ya estaba **centrado y de cuerpo
  entero a las 23:11:21** — seis segundos antes.

Es decir: el evento llega cuando el clasificador del grabador se convence, no cuando la persona
aparece. El frame que hoy les mandamos se toma después de eso, y suele ser el peor de la secuencia.

Teniendo 20 o 40 frames del mismo paso, la probabilidad de que **al menos uno** sea analizable sube
muchísimo — no porque el modelo cambie, sino porque en 20 segundos el sujeto se mueve y cambia
distancia, ángulo e iluminación.

**Nota honesta:** todavía no medimos esa curva. Es nuestra próxima medición y se las vamos a pasar.
Pero para medirla necesitamos exactamente esta capacidad, y hacerlo a un request por segundo hace
la medición impracticable.

---

## 3. Por qué también les conviene

- **Menos requests, no más.** Hoy, si implementamos esto contra el endpoint actual, les generamos
  ráfagas de 40 requests por evento. Un batch es 1.
- **Menos handshake.** Cada request nuestro carga headers, TLS y una validación de sesión para
  transportar una imagen.
- **Pueden cortar antes.** Ver la opción `stopOnFirstDetection` en §4: en la mayoría de los eventos
  reales alcanza con procesar unos pocos frames antes de encontrar la persona. Eso les ahorra
  cómputo respecto de los 40 requests sueltos, donde no tienen forma de saber que ya alcanzaba.

---

## 4. Contrato propuesto

Endpoint nuevo, para no tocar el actual ni obligar a nadie a migrar:

```
POST {FACE_AUTH_API_URL}/api/v1/persons/batch
  Fa-Domain: {domain}
  Fa-Token:  {session token}
  Content-Type: multipart/form-data
```

**Request** — mismo `multipart/form-data` que hoy, con el campo de archivo repetido:

```
files: frame_001.jpg
files: frame_002.jpg
...
files: frame_040.jpg
```

Opcionales, como campos del form:

| Campo                  | Tipo                     | Para qué                                                                                                                                                          |
| ---------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stopOnFirstDetection` | boolean, default `false` | Procesar en orden y cortar en la primera imagen con detecciones. Las restantes vuelven con `skipped: true`. **Es la que más nos sirve y más cómputo les ahorra.** |
| `minDetScore`          | number                   | Filtrar del lado de ustedes. Hoy filtramos nosotros; si cortan antes, viaja menos payload.                                                                        |

**Response** — un resultado por imagen, en el mismo orden en que se enviaron:

```json
{
  "results": [
    {
      "index": 0,
      "filename": "frame_001.jpg",
      "status": "ok",
      "personsDetected": false,
      "imageWidth": 960,
      "imageHeight": 1088,
      "persons": []
    },
    {
      "index": 1,
      "filename": "frame_002.jpg",
      "status": "ok",
      "personsDetected": true,
      "imageWidth": 960,
      "imageHeight": 1088,
      "persons": [
        {
          "detScore": 0.91,
          "bbox": {
            "topLeft": { "x": 417, "y": 163 },
            "bottomRight": { "x": 596, "y": 682 }
          },
          "bboxNorm": {
            "topLeft": { "x": 0.32, "y": 0.22 },
            "bottomRight": { "x": 0.46, "y": 0.94 }
          },
          "anchor": { "x": 0.396, "y": 0.947 }
        }
      ]
    },
    {
      "index": 2,
      "filename": "frame_003.jpg",
      "status": "skipped"
    }
  ]
}
```

El objeto de cada `results[i]` con `status: "ok"` es **exactamente el cuerpo que hoy devuelve
`/persons`**, más `index`, `filename` y `status`. Así podemos reusar el mismo parser y la misma
validación de borde que ya tenemos.

### Detalles que nos importan

1. **Correlación explícita.** Necesitamos `index` (y ojalá `filename`) en la respuesta. Confiar en
   el orden del array es frágil si en algún momento paralelizan internamente.
2. **Falla parcial, no total.** Si una imagen viene corrupta o no se puede decodificar, queremos
   `status: "error"` con un código en esa entrada y `200` en el request — no un `500` que tire las
   otras 39. Una sola imagen mala no debería costarnos el evento entero.
3. **Límites documentados.** Máximo de imágenes por request y máximo de bytes totales. Preferimos un
   `413` claro a un timeout. Nuestras imágenes son JPEG de ~100 KB, 960×1088; un batch de 40 son
   unos 4 MB.
4. **Timeout.** Si 40 imágenes pueden tardar más que el timeout actual, díganlo y lo subimos de
   nuestro lado. Hoy cortamos a los 10 s (`DETECT_TIMEOUT_MS`).
5. **Cómo cuenta contra el rate limit.** Idealmente 1 batch = 1 request. Si prefieren que cuente
   como N, también sirve, pero necesitamos saberlo para pacear bien.
6. **`429` con `Retry-After`.** Hoy no lo mandan y asumimos 5 segundos a ciegas. Con batch el costo
   de equivocarse es mayor.

---

## 4bis. Detalles del contrato ya confirmados por ustedes

Anotados el 2026-09-10, mientras construyen el endpoint. Los dejamos escritos acá para que nuestra
implementación los respete y para que quede registro de qué asumimos.

1. **Éxito devuelve `201`, no `200`.** Nuestro cliente valida el rango 2xx y no una igualdad, así que
   ya funciona — pero queda dicho para que nadie escriba `=== 200` al agregar el método batch.
2. **`stopOnFirstDetection` corta al final de una tanda de 8**, no en la imagen exacta. Consecuencias
   que asumimos: con 8 imágenes o menos nunca hay `skipped` ni ahorro; pasado el primer hit se
   procesan hasta 7 imágenes más; y los tamaños útiles de request son múltiplos de 8. Nos sirve igual
   — nuestra ventana recomendada es de 24 frames, o sea tres tandas, y por lo que medimos el hit suele
   caer en la primera.

## 4ter. Un dato nuevo que refuerza el punto 4.2

Midiendo 40 frames de un evento real el 2026-09-10, **uno volvió con HTTP 500** — 2,5% de falla, y
justo en el medio del grupo de frames con mejor detección (entre un 0,634 y un 0,809). Si ese request
hubiera sido un batch que falla entero en vez de por imagen, habríamos perdido las otras 39.

Es exactamente el caso del punto 4.2, ahora con evidencia.

---

## 5. Si el batch no es viable

En orden de preferencia:

1. **Un límite de tasa mayor para nuestro dominio.** No resuelve el handshake ni les deja cortar
   antes, pero desbloquea la medición. Con 5 req/s ya podríamos trabajar.
2. **Una ventana de ráfaga explícita y documentada** — por ejemplo N requests seguidos y después la
   tasa normal. Medimos que hoy existe algo así (429 tras ~17 requests a 250 ms de espaciado), pero
   al no estar documentado no podemos apoyarnos en ello.
3. **`Retry-After` en los `429`.** Es lo más barato de todo y hoy no está.

---

## 6. Qué podemos entregar

- Los frames de la ventana del evento del 2026-09-09 23:11 en canal 8, donde se ve el sujeto seis
  segundos antes de que el grabador lo reportara. Son imágenes de un domicilio particular con
  personas identificables: por canal privado y bajo el acuerdo que corresponda.
- La curva de detección por cantidad de frames, en cuanto la midamos — es el argumento cuantitativo
  de este pedido y se las pasamos aunque salga en contra.
- Volumen estimado, en cuanto contemos eventos de movimiento por cámara por noche. Todavía no lo
  medimos y no queremos inventarlo.
