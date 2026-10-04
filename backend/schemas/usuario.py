from uuid import UUID

from pydantic import BaseModel


class UsuarioPruebaResponse(BaseModel):
    user_id: UUID
    email: str
    nombre: str
