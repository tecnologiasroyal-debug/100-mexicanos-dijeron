# 100 Mexicanos Dijeron — V8 AUDITADO

Versión completa para PythonAnywhere y uso local. Esta versión corrige el problema **“Acción no reconocida”** al elegir qué familia ganó el duelo y añade comprobaciones para detectar si el navegador y PythonAnywhere están ejecutando versiones diferentes.

## Flujo del conductor

**Equipos → Preparar → Duelo → Familia → Cerrar**

1. **Equipos:** nombres y marcador.
2. **Preparar:** pregunta y multiplicador ×1 / ×2 / ×3.
3. **Duelo:** pasan dos participantes a los zumbadores físicos, se pueden revelar sus respuestas y el conductor elige qué familia continúa.
4. **Familia:** respuestas, STRIKES, temporizador y bolsa de puntos.
5. **Cerrar:** ronda normal o robo, entrega única de puntos, revelado de respuestas faltantes sin volver a sumar y siguiente ronda.

## Correcciones V8

- `set_control_team` está implementado y probado en backend y frontend.
- Compatibilidad con alias `faceoff_winner`, `duel_winner`, `choose_control_team` y `set_family_control`.
- La interfaz y el servidor publican versión **8.0.0**.
- Endpoint de diagnóstico: `/api/version`.
- Si el navegador carga V8 pero PythonAnywhere sigue con un backend anterior, el conductor muestra un aviso explícito en lugar de un error genérico.
- Bloqueo de doble toque al escoger al ganador del duelo.
- Una vez elegida la familia en control, no se puede cambiar por accidente; se usa **Deshacer** para corregir.
- No se puede revelar una respuesta antes de iniciar el duelo.
- No se puede cambiar pregunta a mitad de ronda.
- No se puede avanzar a la siguiente pregunta sin cerrar y entregar la ronda.
- El multiplicador queda bloqueado cuando inicia el duelo.
- Se conserva el flujo posterior a un robo: entregar puntos → revelar faltantes → siguiente pregunta.

## Sonidos incluidos

En `static/sounds/` están los cuatro MP3 proporcionados:

- `iniciar_ronda.mp3`
- `respuesta_correcta.mp3`
- `strike.mp3`
- `ganar_ronda.mp3`

También se conservan los WAV de respaldo para tiempo agotado y otros eventos.

## Actualización segura de PythonAnywhere

**No reemplaces la carpeta `data` de tu servidor si quieres conservar preguntas, marcadores e historial de usadas.**

1. Descomprime este ZIP.
2. Sube los archivos a GitHub y reemplaza los anteriores. Como mínimo deben actualizarse:
   - `app.py`
   - `game_logic.py`
   - `pythonanywhere_wsgi.py`
   - carpeta `static`
3. En PythonAnywhere abre **Consoles → Bash** y ejecuta:

```bash
cd ~/100-mexicanos-dijeron
git fetch origin
git checkout origin/main -- app.py game_logic.py excel_import.py pythonanywhere_wsgi.py static README.md VERSION_V8_AUDITADO.txt
```

4. Comprueba que realmente llegó V8:

```bash
grep -n 'APP_VERSION = "8.0.0"' app.py
grep -n 'CLIENT_VERSION = "8.0.0"' static/control.js
grep -n 'set_control_team' app.py static/control.js
```

5. En **Web** pulsa **Reload rivaspruebas.pythonanywhere.com**.
6. Abre en el navegador:

`https://rivaspruebas.pythonanywhere.com/api/version`

Debe aparecer `app_version: 8.0.0` y `set_control_team` dentro de `supported_actions`.

7. Abre el conductor en una pestaña nueva:

`https://rivaspruebas.pythonanywhere.com/control?v=8`

## Datos persistentes

Los archivos importantes están en `data/`:

- `question_bank.json`: banco de preguntas.
- `question_usage.json`: preguntas ya usadas.
- `game_state.json`: estado y marcadores.
- `config.json`: configuración local.

Para conservar una instalación existente, no sustituyas esos archivos al actualizar código.

## Zumbadores

La V8 usa zumbadores físicos como apoyo presencial, pero no los lee electrónicamente. El conductor observa quién pulsó primero y selecciona desde el celular qué familia ganó el duelo.

## Pruebas V8

Se verificaron compilación Python, sintaxis JavaScript, contrato frontend/backend, flujo del duelo, selección de familia, STRIKES, multiplicadores, entrega única, robo, revelado posterior sin re-sumar, siguiente pregunta, undo, importación Excel, sincronización y endpoint de versión.
