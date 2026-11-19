import {useRef,useState} from 'react';
import {placeLabelElement} from '../../../shared/barcode-layout';

export default function BarcodeLayoutEditor({preview,disabled,onMove}){
  const canvas=useRef(null),drag=useRef(null);
  const [draft,setDraft]=useState(null);
  const position=element=>draft?.revision===preview.editorRevision && draft.key===element.key ? draft : element;
  const pointFor=(element,x,y)=>placeLabelElement(element,{x:x/preview.width,y:y/preview.height},preview);
  const start=(event,element)=>{
    if(disabled || (event.button!=null && event.button!==0))return;
    event.preventDefault();event.currentTarget.focus();
    const point=position(element);
    drag.current={element,x:point.x,y:point.y,clientX:event.clientX,clientY:event.clientY,pointerId:event.pointerId};
    try{event.currentTarget.setPointerCapture(event.pointerId);}catch{/* Synthetic pointer events have no capture target. */}
  };
  const move=event=>{
    const current=drag.current;if(!current || current.pointerId!==event.pointerId)return;
    const rect=canvas.current.getBoundingClientRect();
    const point=pointFor(current.element,current.x+(event.clientX-current.clientX)*preview.width/rect.width,current.y+(event.clientY-current.clientY)*preview.height/rect.height);
    drag.current.point=point;
    setDraft({key:current.element.key,revision:preview.editorRevision,...point});
  };
  const finish=event=>{
    const current=drag.current;if(!current || current.pointerId!==event.pointerId)return;
    drag.current=null;
    try{event.currentTarget.releasePointerCapture(event.pointerId);}catch{/* Capture may already be released. */}
    if(current.point)onMove(current.element.key,{x:current.point.x/preview.width,y:current.point.y/preview.height});
  };
  const keyboard=(event,element)=>{
    const steps={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    const step=steps[event.key];if(!step || disabled)return;
    event.preventDefault();const current=position(element),scale=event.shiftKey?10:1;
    const point=pointFor(element,current.x+step[0]*scale,current.y+step[1]*scale);
    setDraft({key:element.key,revision:preview.editorRevision,...point});
    onMove(element.key,{x:point.x/preview.width,y:point.y/preview.height});
  };
  if(!preview.elements?.length)return <img src={preview.image} alt="Pratinjau pengaturan barcode" />;
  return <div ref={canvas} className="barcode-layout-canvas" style={{maxWidth:preview.width,aspectRatio:`${preview.width} / ${preview.height}`}}>
    <img className="barcode-layout-full-preview" src={preview.image} alt="Pratinjau pengaturan barcode" />
    {preview.elements?.map(element=>{
      const point=position(element);
      return <button key={element.key} type="button" className="barcode-layout-element" data-barcode-element={element.key} aria-label={`Geser ${element.label}`} title={`${element.label} — geser untuk memindahkan`} disabled={disabled}
        style={{left:`${point.x/preview.width*100}%`,top:`${point.y/preview.height*100}%`,width:`${element.width/preview.width*100}%`,height:`${element.height/preview.height*100}%`}}
        onPointerDown={event=>start(event,element)} onPointerMove={move} onPointerUp={finish} onPointerCancel={()=>{drag.current=null;setDraft(null);}} onKeyDown={event=>keyboard(event,element)}>
        <img src={element.image} alt="" draggable={false} />
      </button>;
    })}
  </div>;
}
