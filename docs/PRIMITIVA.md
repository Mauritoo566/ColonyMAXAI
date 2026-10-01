# Edad Primitiva: auditoría del recorrido

Generado desde `src/sim/primitiveAudit.js`. Cada fila se comprueba contra el juego real en
`server/game/test/primitive.test.js` (no es sólo documentación).

| Paso | Acción | Recursos necesarios | Origen | Edificio o capacidad requerida | Resultado | Si falta algo |
|---|---|---|---|---|---|---|
| 1. Fundar | Pulsar «Fundar campamento» | — | Se crean con la partida | Una ubicación válida | Fogata, 5 colonos, refugio de ramas (2 plazas), recolector de lluvia con agua y acopio inicial | Si el lugar es difícil, el aviso del puntero lo dice antes de fundar |
| 2. Ramas y madera | Recolectar palos caídos (zona marcada o solos) — sin hacha | — | Palos y ramas caídos en el suelo (cada montón da 2 de madera y 1 de fibra; se agotan, no se renuevan); los árboles en pie no se talan en Primitiva | Un colono adulto | +madera y +fibra en el acopio | Si se agotan, la interfaz avisa y hay que marcar otra zona |
| 3. Piedras sueltas | Recolectar (filtro Piedra) — sin pico | — | Piedras del terreno (no es cantera) | Un colono adulto | +piedra | Cada piedra recogida desaparece: no se renueva |
| 4. Comida silvestre | Recolectar (filtro Comida) | — | Bayas y setas (rebrotan despacio) | Un colono adulto | +comida y +fibra | Los colonos también comen solos de los arbustos cercanos |
| 5. Agua | Beber del recolector de lluvia (ya construido) | Lluvia (con tiempo seco, sólo rocío) | Recolector de lluvia inicial | No hace falta un río ni el pozo | Agua visible (cantidad, capacidad, consumo y días de reserva) | Sin lluvia la reserva baja: construir otro recolector (límite 2) da margen |
| 6. Refugios para todos | Construir chozas de ramas | 18 madera/ramas, 6 fibras cada una | Acopio inicial + lo recolectado | Colonos adultos que construyan; hasta 3 refugios; sin edificio previo | +2 plazas por refugio; los niños viven con su madre | Quien no tiene plaza duerme junto a la fogata y descansa peor |
| 7. Almacén primitivo | Construir la pila de troncos y cestas | 12 madera/ramas, 4 fibras | Acopio inicial | Colonos adultos; sin edificio previo | Más capacidad de almacenamiento | Su coste cabe en el acopio inicial (no hay que ampliar antes de construirlo) |
| 8. Primera herramienta de piedra | Fabricarla desde la guía (tarda un rato) | 6 piedras, 4 madera/ramas, 4 fibras | Acopio inicial + lo recolectado | Un adulto; ningún taller; sólo materiales primitivos | Hito registrado «primera herramienta de piedra» (no desbloquea mejoras) | Si faltan materiales, el botón dice cuáles |
| 9. Estabilizar | Mantener reservas | 12 comida y 10 agua (se conservan) | Recolección y lluvia | Recolector de lluvia; comida silvestre | Requisito de reservas cumplido | La reserva no se gasta al avanzar |
| 10. Avanzar a Piedra | Pulsar «Avanzar» cuando todo esté listo | 30 madera/ramas, 15 piedras, 10 fibras (se gastan) | Recolección | Refugio para todos, almacén, herramienta y reservas; sin población mínima | Viviendas evolucionan solas; se desbloquea lo de Piedra | La ventana de edades lista cada requisito con su progreso |
| 11. Sin bloqueos de diseño | Revisar requisitos y herramientas | — | — | Ni tala, ni cantera, ni cultivo, ni pozo, ni metales | Ningún requisito exige algo de Piedra | Sin cadenas circulares |

## Reglas que cumple

- Población máxima de la edad: 10 (no concede plazas de refugio). Crece sólo por nacimientos; sin inmigración.
- Refugio inicial: choza de ramas (2 plazas). Sin plaza, se duerme junto a la fogata y se descansa peor.
- El agua sale del recolector de lluvia: no hace falta un río.
- Sin lluvia pueden bajar las reservas; la escasez puede matar (con el dueño presente). Las ausencias no cambian.
- Todos los requisitos de Piedra se cumplen con recursos de Primitiva.
