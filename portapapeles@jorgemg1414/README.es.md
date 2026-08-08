# Portapapeles

*[Read this in English](README.md)*

Lo último que has copiado, en la barra superior.

```bash
./install.sh --enable
```

Necesita **CopyQ**, que es de donde sale el historial. Si no lo tienes, la
carpeta [`portapapeles/`](../portapapeles/) lo instala y le pone los atajos de
teclado:

```bash
../portapapeles/instalar.sh
```

---

## El historial no es suyo

Esta extensión **no guarda nada**. Lee el historial de CopyQ —el mismo que abre
`Super+V`, el mismo que sigue ahí con la extensión desactivada— y lo pinta.

Es a propósito. Un historial propio significaría dos listas que no se hablan:
copias algo con el menú cerrado, lo buscas luego en la ventana de CopyQ y no
está, o al revés. Con una sola lista no hay nada que sincronizar.

Y tampoco pregunta nada mientras el menú está cerrado: no hay temporizador ni
vigilancia del portapapeles. Se lee al abrir el menú, y ya.

## Qué hace cada cosa

| Dónde | Qué pasa |
|---|---|
| **Clic en un elemento** | Lo copia al portapapeles y cierra el menú. Con *Pegar al elegir* activado, además lo pega donde estuvieras |
| **Clic derecho en un elemento** | Abre debajo sus dos acciones: **Copiar** (sin pegar) y **Quitar** |
| **Escribir en el buscador** | Filtra por el **texto entero** del elemento, no solo por la línea que se ve. `↓`/`↑` recorren la lista e `Intro` usa el primero |
| **Abrir CopyQ** | La ventana entera, para lo que no cabe en el menú |
| **Vaciar** | Borra el historial. Pregunta antes, en el propio menú |

## Cómo se lee cada fila

Un elemento copiado de un editor trae saltos de línea y sangrías, y en una fila
de menú eso solo sirve para que no se lea nada. Se pinta **en una línea**, con
los espacios de sobra recogidos y lo que no cabe cortado con puntos
suspensivos. El original no se toca: lo que se copia al pulsar es el elemento
entero, con todos sus formatos.

Cuando el elemento tiene más de una línea, a la derecha sale **cuántas son**.
Es lo único que distingue un párrafo de doscientas líneas de la frase que se ve.

Un elemento que no es texto —una imagen pegada— sale en cursiva y apagado, como
*(sin texto)*. Se enseña, y no se salta, para que la numeración cuadre con la
de CopyQ.

## Pegar al elegir

Está **desactivado** de fábrica, y conviene saber por qué antes de encenderlo.

Lo que hace es mandar un `Ctrl+V` a la ventana que tuviera el foco antes de
abrirse el menú, esperando 200 ms a que el foco vuelva. Ese «esperando» es el
problema: si la ventana tarda más, la pulsación se pierde. Funciona bien en la
mayoría de sitios y regular en algunos.

El `Super+V` de CopyQ no tiene ese problema, porque nunca le quita el foco a
nadie. Si lo que quieres es pegar rápido, ese es el camino; el menú de la barra
es para mirar la lista.

## Por qué no hay contador en el icono

Las otras extensiones llevan un número junto al icono: cuántos equipos no
responden, cuántas tareas quedan. Aquí no, por dos motivos. El primero es que
el número sería siempre el tope que tenga puesto CopyQ, o sea, ninguna
información. El segundo es que la alternativa —enseñar en la barra un trozo de
lo último copiado— pondría a la vista de cualquiera la contraseña que acabas de
sacar del gestor.

## Ajustes

En *Extensiones → Portapapeles → Preferencias*:

- **Elementos en el menú** (25) — CopyQ guarda muchos más; los que no caben
  siguen en su ventana. Cuantos más se pidan, más tarda el menú en abrirse.
- **Pegar al elegir** (no) — lo de arriba.
- **Buscador** (sí, a partir de 10 elementos).
- **Icono del panel** y **sitio en la barra**.

## Cómo habla con CopyQ

Todo va por `copyq eval`, y no por los comandos sueltos de la línea de órdenes.
La razón está en la lectura del historial: `copyq read` devuelve los elementos
pegados unos a otros y hay que separarlos por un carácter que ninguno de ellos
contenga, y ese carácter no existe cuando lo que guardas es texto arbitrario.
Con `eval` se pide un JSON y no hay que inventarse nada.

El guion va como un argumento más del proceso, no por un intérprete de órdenes,
así que las comillas que lleve el texto copiado son suyas y no hay nada que
escapar.

## Si algo no va

El menú lo dice él mismo:

- **«CopyQ no está instalado»** — falta el paquete.
- **«CopyQ está instalado, pero no en marcha»** — con un botón para arrancarlo.
  Vuelve a leer solo un segundo después.
- **«CopyQ ha contestado algo que no se entiende»** — contestó, pero no con el
  JSON esperado. Suele ser una versión de CopyQ con otra API de guion; se ve
  con:

  ```bash
  copyq eval -- 'print(JSON.stringify({total: size()}))'
  ```
