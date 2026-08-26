from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime

Base = declarative_base()

class ConflictosSincronizacion(Base):
    __tablename__ = "conflictos_sincronizacion"
    
    id = Column(Integer, primary_key=True, index=True)
    reserva_id = Column(Integer, nullable=False, index=True)
    jti_involucrado = Column(String, nullable=False)
    motivo = Column(String, nullable=False)
    fecha_registro = Column(DateTime, default=datetime.utcnow)