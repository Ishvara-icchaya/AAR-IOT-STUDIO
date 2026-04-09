import logging

from fastapi import APIRouter

router = APIRouter()
log = logging.getLogger(__name__)


@router.get("")
def list_pulls():
    log.debug("data_pulls.list_pulls")
    return {"items": []}
