# RUBENS

Software for the Motor Brush drawing machine: draw brush strokes, pick eight
drops of paint, preview the result, then let the machine run the brush across
the canvas.

| where | what |
|---|---|
| [`Rubens_v2.md`](Rubens_v2.md) | the spec: decisions, the contract with the machine, work order |
| [`CHANGELOG.md`](CHANGELOG.md) | what changed, version by version |
| [`CALIBRATION.md`](CALIBRATION.md) | the dated log of machine measurements (CNCDM-001) |
| [`rubens-preview/`](rubens-preview/) | the app: Create, Calibration and Job tabs, and `rubens.py`, which runs the machine on USB. How to run it — in its `README.md` |
| [`firmware/CNCDM-001/`](firmware/CNCDM-001/) | the machine's firmware, and its board, pins, drivers and rules |
| [`images_CNC_drawing_machine/`](images_CNC_drawing_machine/) | photos of the machine, its boards and the arm drawing "Lapa" |

Everything for the machine is here since 2026-09-29. Its first repository,
`forma78/CNCDM-001` (the bridge, the MELNICOMM pendant, the history), is
archived.

## License

The code and the documents are under the [MIT License](LICENSE), except
`firmware/CNCDM-001/lib/SCServo/`, Feetech's servo library ([its
notice](firmware/CNCDM-001/lib/SCServo/NOTICE.md)).
The photos and drawings in `images_CNC_drawing_machine/` are not: they are
© 2026 Theo Sumkin, all rights reserved.
