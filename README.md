# 100 Mexicanos Dijeron — V4 COMPLETO

Versión preparada para `rivaspruebas.pythonanywhere.com` o cualquier cuenta equivalente de PythonAnywhere.

## Cambios de esta versión

- En tablero público cambia **Errores** por **STRIKES**.
- Control del conductor rediseñado para celular: botones grandes, colores y accesos rápidos fijos.
- Botón **INICIAR RONDA** con evento de sonido independiente.
- Al entregar puntos la ronda entra en **REVISIÓN**: puedes descubrir las respuestas faltantes y **ya no suman puntos**.
- Botón **SIGUIENTE PREGUNTA** solo después de entregar la ronda.
- Historial persistente de preguntas usadas en `data/question_usage.json`.
- Las preguntas usadas quedan excluidas de la selección automática incluso otro día.
- Avisos cuando el banco llega a 50, 25, 10 o 0 preguntas disponibles.
- Botón privado para reiniciar el historial de preguntas usadas.
- Incluye los cuatro MP3 personalizados proporcionados, con respaldo automático a los WAV incluidos.

## Sonidos MP3 personalizados

Esta versión YA incluye en `static/sounds/`:

- `iniciar_ronda.mp3`
- `respuesta_correcta.mp3`
- `strike.mp3`
- `ganar_ronda.mp3`

Los WAV de respaldo se conservan para los demás eventos y como compatibilidad.

## Actualizar una instalación existente en PythonAnywhere

1. Sube estos archivos al repositorio de GitHub `100-mexicanos-dijeron` y haz Commit.
2. En PythonAnywhere abre una consola **Bash**.
3. Ejecuta:

```bash
cd ~/100-mexicanos-dijeron
git pull
```

4. Ve a **Web** y pulsa **Reload rivaspruebas.pythonanywhere.com**.
5. Abre:
   - Tablero: `https://rivaspruebas.pythonanywhere.com/public`
   - Control: `https://rivaspruebas.pythonanywhere.com/control`

## Banco de 500 preguntas

Esta versión incluye el motor de historial/uso, pero **no añade todavía las 500 preguntas**, porque se acordó revisar/aprobar primero el estilo de las preguntas antes de incorporarlas al banco definitivo.

## Persistencia

PythonAnywhere guarda `data/question_usage.json`, `data/game_state.json` y `data/question_bank.json` en el almacenamiento de tu cuenta. Por eso el historial de usadas se conserva entre sesiones y días, salvo que tú lo reinicies o reemplaces esos archivos.

## Panel del conductor V5
El panel del conductor ahora usa un flujo guiado de cuatro pasos: Equipos, Preparar, Jugar y Cerrar. Las funciones secundarias quedaron dentro de un menú lateral para evitar una página larga con scroll. El logo de 100 Mexicanos Dijeron y el crédito "Desarrollado por Carlos Rivas" están visibles también en el panel del conductor.
