"""usuarios: fecha de vencimiento de la membresía

Revision ID: f7a2d9c41b60
Revises: e5b3a7c91d24
Create Date: 2026-10-28 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f7a2d9c41b60'
down_revision: Union[str, Sequence[str], None] = 'e5b3a7c91d24'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('usuarios', sa.Column('membresia_vence', sa.Date(), nullable=True))

    # Los socios que ya figuraban como "Activo" conservan su membresía hasta fin de este año
    # (según la fecha del camping). El resto queda sin fecha: figura como cuota vencida
    # hasta que el administrador cargue el vencimiento.
    op.execute(
        "UPDATE usuarios "
        "SET membresia_vence = make_date("
        "EXTRACT(YEAR FROM (now() AT TIME ZONE 'America/Argentina/Buenos_Aires'))::int, 12, 31) "
        "WHERE is_socio = true AND lower(estado_cuota) = 'activo'"
    )


def downgrade() -> None:
    op.drop_column('usuarios', 'membresia_vence')
