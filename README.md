# 100 Mexicanos Dijeron — versión para Render

Juego familiar con tablero público y control privado desde el celular.

## Render

- Runtime: Python 3
- Build Command: `echo Sin dependencias externas`
- Start Command: `python app.py`
- Variable de entorno obligatoria: `CONTROL_PIN` con exactamente 6 dígitos, por ejemplo `482731`.

Cuando Render termine el despliegue:

- Tablero: `https://TU-SERVICIO.onrender.com/public`
- Control: `https://TU-SERVICIO.onrender.com/control`
- Página privada de conexión/QR: `https://TU-SERVICIO.onrender.com/setup?code=TU_CONTROL_PIN`

No publiques tu CONTROL_PIN.

## Persistencia en el plan gratuito

Render puede reiniciar el servicio y su disco local es efímero. La partida y las preguntas importadas se guardan mientras la instancia conserve su almacenamiento, pero podrían volver a los archivos incluidos tras un reinicio/redeploy. Conserva tu archivo Excel como respaldo.
