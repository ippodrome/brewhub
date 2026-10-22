-- Weight taps: density-based volume (1.3.0). Both nullable on purpose:
-- existing weight taps keep the legacy tare/full interpolation until the
-- user sets a density or FG, so upgrading changes no numbers by itself.
-- Plain ADD COLUMN — no CHECK involved, no table rebuild needed.
ALTER TABLE taps ADD COLUMN beer_density_kg_per_l REAL;
ALTER TABLE taps ADD COLUMN final_gravity_sg REAL;
