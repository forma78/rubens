# RUBENS

Software for the Motor Brush drawing machine: draw brush strokes, pick eight
drops of paint, preview the result, then let the machine run the brush across
the canvas.

| where | what |
|---|---|
| [`Rubens_v2.md`](Rubens_v2.md) | the spec: decisions, the contract with the machine, work order |
| [`CHANGELOG.md`](CHANGELOG.md) | what changed, version by version |
| [`CALIBRATION.md`](CALIBRATION.md) | the dated log of machine measurements (CNCDM-001) |
| [`rubens-preview/`](rubens-preview/) | the app: Create, Calibration and Job tabs. How to run it — in its `README.md` |
| [`images_CNC_drawing_machine/`](images_CNC_drawing_machine/) | photos of the machine and the arm drawing "Lapa" |

Firmware, the serial bridge and the MELNICOMM pendant live separately, with
the machine itself: CNCDM-001, a private repository.

## License

The code and the documents are under the [MIT License](LICENSE).
The photos and drawings in `images_CNC_drawing_machine/` are not: they are
© 2026 Theo Sumkin, all rights reserved.
