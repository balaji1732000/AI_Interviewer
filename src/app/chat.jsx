/* eslint-disable @next/next/no-img-element */
"use client";

import { useId, useEffect, useRef, useState } from "react";
import { useChat } from "ai/react";
import useSilenceAwareRecorder from "silence-aware-recorder/react";
import useMediaRecorder from "@wmik/use-media-recorder";
import "./Avatar.css";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";
import { createAvatarSynthesizer, createWebRTCConnection } from "./Utility";
import { avatarAppConfig } from "./config";
import mergeImages from "merge-images";
import { useLocalStorage } from "../lib/use-local-storage";

const INTERVAL = 500;
const IMAGE_WIDTH = 512;
const IMAGE_QUALITY = 0.6;
const COLUMNS = 4;
const MAX_SCREENSHOTS = 60;
const SILENCE_DURATION = 2500;
const SILENT_THRESHOLD = -30;

const transparentPixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/wcAAwAB/2lXzAAAACV0RVh0ZGF0ZTpjcmVhdGU9MjAyMy0xMC0xOFQxNTo0MDozMCswMDowMEfahTAAAAAldEVYdGRhdGU6bW9kaWZ5PTIwMjMtMTAtMThUMTU6NDA6MzArMDA6MDBa8cKfAAAAAElFTkSuQmCC";

// A function that plays an audio from a url and reutnrs a promise that resolves when the audio ends
function playAudio(url) {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    audio.onended = resolve;
    audio.play();
  });
}

async function getImageDimensions(src) {
  return new Promise((resolve, reject) => {
    const img = new globalThis.Image();

    img.onload = function () {
      resolve({
        width: this.width,
        height: this.height,
      });
    };

    img.onerror = function () {
      reject(new Error("Failed to load image."));
    };

    img.src = src;
  });
}

function base64ToBlob(base64, mimeType) {
  const byteCharacters = atob(base64.split(",")[1]);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

async function uploadImageToFreeImageHost(base64Image) {
  const blob = base64ToBlob(base64Image, "image/jpeg");
  const formData = new FormData();
  formData.append("file", blob, "image.jpg");

  const response = await fetch("https://tmpfiles.org/api/v1/upload", {
    method: "POST",
    body: formData,
  });

  const { data } = await response.json();

  return data.url.replace("https://tmpfiles.org/", "https://tmpfiles.org/dl/");
}

async function imagesGrid({
  base64Images,
  columns = COLUMNS,
  gridImageWidth = IMAGE_WIDTH,
  quality = IMAGE_QUALITY,
}) {
  if (!base64Images.length) {
    return transparentPixel;
  }

  const dimensions = await getImageDimensions(base64Images[0]);

  // Calculate the aspect ratio of the first image
  const aspectRatio = dimensions.width / dimensions.height;

  const gridImageHeight = gridImageWidth / aspectRatio;

  const rows = Math.ceil(base64Images.length / columns); // Number of rows

  // Prepare the images for merging
  const imagesWithCoordinates = base64Images.map((src, index) => ({
    src,
    x: (index % columns) * gridImageWidth,
    y: Math.floor(index / columns) * gridImageHeight,
  }));

  // Merge images into a single base64 string
  return await mergeImages(imagesWithCoordinates, {
    format: "image/jpeg",
    quality,
    width: columns * gridImageWidth,
    height: rows * gridImageHeight,
  });
}







export default function Chat() {


  // const [avatarSynthesizer, setAvatarSynthesizer] = useState(null);

  let avatarSynthesizer = createAvatarSynthesizer();
  const id = useId();
  const maxVolumeRef = useRef(0);
  const minVolumeRef = useRef(-100);
  const [displayDebug, setDisplayDebug] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [phase, setPhase] = useState("not inited");
  const [transcription, setTranscription] = useState("");
  const [imagesGridUrl, setImagesGridUrl] = useState(null);
  const [currentVolume, setCurrentVolume] = useState(-50);
  const [volumePercentage, setVolumePercentage] = useState(0);
  // const [token, setToken] = useLocalStorage("ai-token", "");
  const token = "*************************************";
  const [lang, setLang] = useLocalStorage("lang", "");
  const isBusy = useRef(false);
  const screenshotsRef = useRef([]);
  const videoRef = useRef();
  const canvasRef = useRef();

  var iceUrl = avatarAppConfig.iceUrl
  var iceUsername = avatarAppConfig.iceUsername
  var iceCredential = avatarAppConfig.iceCredential
  

  const myAvatarVideoEleRef = useRef();
  const myAvatarAudioEleRef = useRef();
  const [mySpeechText, setMySpeechText] = useState("");
  
  
  const handleSpeechText = (event) => {
    setMySpeechText(event.target.value);
  }
  

  const handleOnTrack = (event) => {
  
    console.log("#### Printing handle onTrack ",event);
  
    // Update UI elements
    console.log("Printing event.track.kind ",event.track.kind);
    if (event.track.kind === 'video') {
        const mediaPlayer = myAvatarVideoEleRef.current;
        mediaPlayer.id = event.track.kind;
        mediaPlayer.srcObject = event.streams[0];
        mediaPlayer.autoplay = true;
        mediaPlayer.playsInline = true;
        mediaPlayer.addEventListener('play', () => {
        window.requestAnimationFrame(()=>{});
      });
    } else {
      // Mute the audio player to make sure it can auto play, will unmute it when speaking
      // Refer to https://developer.mozilla.org/en-US/docs/Web/Media/Autoplay_guide
      //const mediaPlayer = myAvatarVideoEleRef.current;
      const audioPlayer = myAvatarAudioEleRef.current;
      audioPlayer.srcObject = event.streams[0];
      audioPlayer.autoplay = true;
      audioPlayer.playsInline = true;
      audioPlayer.muted = true;
    }
  };
  
  const stopSpeaking = () => {
    avatarSynthesizer.stopSpeakingAsync().then(() => {
      console.log("[" + (new Date()).toISOString() + "] Stop speaking request sent.")
  
    }).catch();
  }  
  
  const stopSession = () => {
  
    try{
      //Stop speaking
      avatarSynthesizer.stopSpeakingAsync().then(() => {
        console.log("[" + (new Date()).toISOString() + "] Stop speaking request sent.")
        // Close the synthesizer
        avatarSynthesizer.close();
      }).catch();
    }catch(e) {
    }
  }
  
const speakSelectedText = async (input) => {

    //Start speaking the text
    const audioPlayer = myAvatarAudioEleRef.current;
    console.log("Audio muted status ",audioPlayer.muted);
    audioPlayer.muted = false;
    console.log("Audio muted status ",audioPlayer.muted);        
    avatarSynthesizer.speakTextAsync(input).then(
        (result) => {
            if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                console.log(result)
                console.log("Speech and avatar synthesized to video stream.")
            } else {
                console.log("Unable to speak. Result ID: " + result.resultId)
                if (result.reason === SpeechSDK.ResultReason.Canceled) {
                    let cancellationDetails = SpeechSDK.CancellationDetails.fromResult(result)
                    console.log(cancellationDetails.reason)
                    if (cancellationDetails.reason === SpeechSDK.CancellationReason.Error) {
                        console.log(cancellationDetails.errorDetails)
                    }
                }
            }
    }).catch((error) => {
        console.log(error)
        avatarSynthesizer.close()
    });
}
  
const startSession = () => {

  let peerConnection = createWebRTCConnection(iceUrl,iceUsername, iceCredential);
  console.log("Peer connection ",peerConnection);
  peerConnection.ontrack = handleOnTrack;
  peerConnection.addTransceiver('video', { direction: 'sendrecv' })
  peerConnection.addTransceiver('audio', { direction: 'sendrecv' })
  
  // let avatarSynthesizer = createAvatarSynthesizer();
  // setAvatarSynthesizer(avatarSynthesizer);
  peerConnection.oniceconnectionstatechange = e => {
      console.log("WebRTC status: " + peerConnection.iceConnectionState)

      if (peerConnection.iceConnectionState === 'connected') {
          console.log("Connected to Azure Avatar service");
      }

      if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
          console.log("Azure Avatar service Disconnected");
      }
  }

  avatarSynthesizer.startAvatarAsync(peerConnection).then((r) => {
      console.log("[" + (new Date()).toISOString() + "] Avatar started.")

  }).catch(
      (error) => {
          console.log("[" + (new Date()).toISOString() + "] Avatar failed to start. Error: " + error)
      }
  );
}




  
  const audio = useSilenceAwareRecorder({
    onDataAvailable: onSpeech,
    onVolumeChange: setCurrentVolume,
    silenceDuration: SILENCE_DURATION,
    silentThreshold: SILENT_THRESHOLD,
    minDecibels: -100,
  });

  let { liveStream, ...video } = useMediaRecorder({
    recordScreen: false,
    blobOptions: { type: "video/webm" },
    mediaStreamConstraints: { audio: false, video: true },
  });

  async function startRecording() {
    try {  
      // Wait for the startSession Promise to resolve  
      await startSession();
      audio.startRecording();  
      video.startRecording();  
      setIsStarted(true);  
      setPhase("user: waiting for speech");  
        
  } catch (error) {  
      console.log('Error starting session:', error);  
  }
}


  function stopRecording() {
    document.location.reload();
  }

  async function onSpeech(data) {
    if (isBusy.current) return;

    // current state is not available here, so we get token from localstorage
    // const token = JSON.parse(localStorage.getItem("ai-token"));

    isBusy.current = true;
    audio.stopRecording();

    setPhase("user: processing speech to text");

    const speechtotextFormData = new FormData();
    speechtotextFormData.append("file", data, "audio.webm");
    speechtotextFormData.append("token", token);
    speechtotextFormData.append("lang", lang);

    const speechtotextResponse = await fetch("/api/speechtotext", {
      method: "POST",
      body: speechtotextFormData,
    });

    const { text, error } = await speechtotextResponse.json();

    if (error) {
      alert(error);
    }

    setTranscription(text);

    setPhase("user: uploading video captures");

    // Keep only the last XXX screenshots
    screenshotsRef.current = screenshotsRef.current.slice(-MAX_SCREENSHOTS);

    const imageUrl = await imagesGrid({
      base64Images: screenshotsRef.current,
    });

    screenshotsRef.current = [];

    const uploadUrl = await uploadImageToFreeImageHost(imageUrl);

    setImagesGridUrl(imageUrl);

    setPhase("user: processing completion");

    await append({
      content: [
        text,
        {
          type: "image_url",
          image_url: {
            url: uploadUrl,
          },
        },
      ],
      role: "user",
    });
  }

  const { messages, append, reload, isLoading } = useChat({
    id,
    body: {
      id,
      token,
      lang,
    },
    async onFinish(message) {
      setPhase("assistant: processing text to speech");

      // same here
      // const token = JSON.parse(localStorage.getItem("ai-token"));

      const texttospeechFormData = new FormData();
      texttospeechFormData.append("input", message.content);
      texttospeechFormData.append("token", token);

      // const response = await fetch("/api/texttospeech", {
      //   method: "POST",
      //   body: texttospeechFormData,
      // });

      console.log(message.content)
      await speakSelectedText("How are you?")

      setPhase("assistant: playing audio");

      // const blob = await response.blob();
      // const url = URL.createObjectURL(blob);
      // await playAudio(url);

      

      audio.startRecording();
      isBusy.current = false;

      setPhase("user: waiting for speech");
    },
  });

  useEffect(() => {
    if (videoRef.current && liveStream && !videoRef.current.srcObject) {
      videoRef.current.srcObject = liveStream;
    }
  }, [liveStream]);
  

  useEffect(() => {
    const captureFrame = () => {
      if (video.status === "recording" && audio.isRecording) {
        const targetWidth = IMAGE_WIDTH;

        const videoNode = videoRef.current;
        const canvasNode = canvasRef.current;

        if (videoNode && canvasNode) {
          const context = canvasNode.getContext("2d");
          const originalWidth = videoNode.videoWidth;
          const originalHeight = videoNode.videoHeight;
          const aspectRatio = originalHeight / originalWidth;

          // Set new width while maintaining aspect ratio
          canvasNode.width = targetWidth;
          canvasNode.height = targetWidth * aspectRatio;

          context.drawImage(
            videoNode,
            0,
            0,
            canvasNode.width,
            canvasNode.height
          );
          // Compress and convert image to JPEG format
          const quality = 1; // Adjust the quality as needed, between 0 and 1
          const base64Image = canvasNode.toDataURL("image/jpeg", quality);

          if (base64Image !== "data:,") {
            screenshotsRef.current.push(base64Image);
          }
        }
      }
    };

    const intervalId = setInterval(captureFrame, INTERVAL);

    return () => {
      clearInterval(intervalId);
    };
  }, [video.status, audio.isRecording]);

  useEffect(() => {
    if (!audio.isRecording) {
      setVolumePercentage(0);
      return;
    }

    if (typeof currentVolume === "number" && isFinite(currentVolume)) {
      if (currentVolume > maxVolumeRef.current)
        maxVolumeRef.current = currentVolume;
      if (currentVolume < minVolumeRef.current)
        minVolumeRef.current = currentVolume;

      if (maxVolumeRef.current !== minVolumeRef.current) {
        setVolumePercentage(
          (currentVolume - minVolumeRef.current) /
            (maxVolumeRef.current - minVolumeRef.current)
        );
      }
    }
  }, [currentVolume, audio.isRecording]);

  const lastAssistantMessage = messages
    .filter((it) => it.role === "assistant")
    .pop();

  return (
    <>
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <div className="antialiased w-screen h-screen p-4 flex flex-col justify-center items-center bg-black">
      <div className="w-full h-full sm:container sm:h-auto grid grid-rows-[auto_1fr] grid-cols-[1fr] sm:grid-cols-[1fr_1fr] sm:grid-rows-[1fr] justify-content-center bg-black">
      <div className="relative m-2">
        <video
          ref={videoRef}
          className="h-auto w-full object-cover rounded-[1rem] bg-gray-900"
          autoPlay
        />
        {audio.isRecording ? (
          <div className="w-16 h-16 absolute bottom-4 left-4 flex justify-center items-center">
            <div
              className="w-16 h-16 bg-red-500 opacity-50 rounded-full"
              style={{
                transform: `scale(${Math.pow(volumePercentage, 4).toFixed(
                  4
                )})`,
              }}
            ></div>
          </div>
        ) : (
          <div className="w-16 h-16 absolute bottom-4 left-4 flex justify-center items-center cursor-pointer">
            <div className="text-5xl text-red-500 opacity-50">⏸</div>
          </div>
        )}
      </div>
      <div className="relative h-[100%] overflow-hidden rounded-[1rem] m-2">
    <div id="myAvatarVideo" className="absolute top-0 w-full">
        <video className="h-auto w-full object-cover rounded-[1rem] bg-gray-900" ref={myAvatarVideoEleRef}></video>
        <audio ref={myAvatarAudioEleRef}></audio>
    </div> 
</div>

    </div>
        <div className="flex flex-wrap justify-center p-4 opacity-50 gap-2">
          {isStarted ? (
           <button
           className="px-6 py-3 text-lg font-semibold bg-gray-700 text-white rounded-lg m-4 transition duration-500 ease-in-out hover:bg-gray-800 transform hover:-translate-y-1 hover:scale-110 shadow-lg"
           onClick={stopRecording}
       >
           Stop session
       </button>
       
          ) : (
        <button    
            className="btn btn-success px-6 py-3 text-lg font-semibold bg-blue-500 text-white rounded-lg m-4 transition duration-500 ease-in-out hover:bg-blue-600 transform hover:-translate-y-1 hover:scale-110 shadow-lg"    
            onClick={startRecording} >    
            Start session    
      </button> 
          )}
         
         <button    
            className="px-6 py-3 text-lg font-semibold bg-green-500 text-white rounded-lg m-4 transition duration-500 ease-in-out hover:bg-green-600 transform hover:-translate-y-1 hover:scale-110 shadow-lg"    
            onClick={() => reload()}    
        >    
            Regenerate    
        </button>   
        <button    
            className="px-6 py-3 text-lg font-semibold bg-yellow-500 text-white rounded-lg m-4 transition duration-500 ease-in-out hover:bg-yellow-600 transform hover:-translate-y-1 hover:scale-110 shadow-lg"    
            onClick={() => setDisplayDebug((p) => !p)}    
        >    
            Debug    
        </button> 
        <button   
            className="btn btn-danger px-6 py-3 text-lg font-semibold bg-red-500 text-white rounded-lg m-4 transition duration-500 ease-in-out hover:bg-red-600 transform hover:-translate-y-1 hover:scale-110 shadow-lg"    
              onClick={stopSession}>    
            Disconnect    
        </button>
         {/* <input
            type="password"
            className="px-4 py-2 bg-gray-700 rounded-md"
            value={token}
            placeholder="OpenAI API key"
            onChange={(e) => setToken(e.target.value)}
          />
          <input
            className="px-4 py-2 bg-gray-700 rounded-md"
            value={lang}
            placeholder="Optional language code"
            onChange={(e) => setLang(e.target.value)}
          /> */}  

          <div className="myButtonGroup d-flex justify-content-around mt-4">
          {/* <button className="btn btn-success px-4 py-2 bg-blue-500 text-white rounded-md"
              onClick={startSession}>
            Connect
          </button> */}
        </div>
        </div>
      </div>
      <div
        className={`bg-[rgba(20,20,20,0.8)] backdrop-blur-xl p-8 rounded-sm absolute left-0 top-0 bottom-0 transition-all w-[75vw] sm:w-[33vw] ${
          displayDebug ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div
          className="absolute z-10 top-4 right-4 opacity-50 cursor-pointer"
          onClick={() => setDisplayDebug(false)}
        >
          ⛌
        </div>
        <div className="space-y-8">
          <div className="space-y-2">
            <div className="font-semibold opacity-50">Phase:</div>
            <p>{phase}</p>
          </div>
          <div className="space-y-2">
            <div className="font-semibold opacity-50">Transcript:</div>
            <p>{transcription || "--"}</p>
          </div>
          <div className="space-y-2">
            <div className="font-semibold opacity-50">Captures:</div>
            <img
              className="object-contain w-full border border-gray-500"
              alt="Grid"
              src={imagesGridUrl || transparentPixel}
            />
          </div>
        </div>
       
       
      </div>

    </>
  );
}

