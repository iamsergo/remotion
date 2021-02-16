import React, {forwardRef, useCallback, useState} from 'react';
import {continueRender, delayRender} from './ready-manager';

const IFrameRefForwarding: React.ForwardRefRenderFunction<
	HTMLIFrameElement,
	React.DetailedHTMLProps<
		React.IframeHTMLAttributes<HTMLIFrameElement>,
		HTMLIFrameElement
	>
> = ({onLoad, ...props}, ref) => {
	const [handle] = useState(() => delayRender());

	const didLoad = useCallback(
		(e: React.SyntheticEvent<HTMLIFrameElement, Event>) => {
			continueRender(handle);
			onLoad?.(e);
		},
		[handle, onLoad]
	);

	return <iframe {...props} ref={ref} onLoad={didLoad} />;
};

export const IFrame = forwardRef(IFrameRefForwarding);