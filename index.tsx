/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

const API_KEY = process.env.API_KEY;

interface Slide {
  title: string;
  content: string[];
  imagePrompt: string;
  imageUrl?: string;
}

type Theme = 'dark' | 'modern' | 'corporate' | 'minimal' | 'academic';

const THEMES: { id: Theme, name: string }[] = [
    { id: 'dark', name: 'Dark' },
    { id: 'modern', name: 'Modern' },
    { id: 'corporate', name: 'Corporate' },
    { id: 'minimal', name: 'Minimal' },
    { id: 'academic', name: 'Academic' },
];

const ai = new GoogleGenAI({ apiKey: API_KEY });

// --- Helper Functions ---

const slideSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      title: {
        type: Type.STRING,
        description: 'A concise, engaging title for the slide.',
      },
      content: {
        type: Type.ARRAY,
        items: {
          type: Type.STRING,
        },
        description: 'An array of 2-4 short, impactful bullet points.',
      },
      imagePrompt: {
        type: Type.STRING,
        description: 'A simple, descriptive prompt for an AI image generator to create a relevant visual. e.g., "A minimalist icon of a lightbulb".',
      },
    },
    required: ["title", "content", "imagePrompt"],
  },
};


// --- React Components ---

const App: React.FC = () => {
    const [topic, setTopic] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [progressText, setProgressText] = useState('');
    const [slides, setSlides] = useState<Slide[]>([]);
    const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
    const [theme, setTheme] = useState<Theme>('dark');
    const [isPrinting, setIsPrinting] = useState(false);

    const handleGeneratePresentation = async () => {
        if (!topic.trim()) return;
        setIsLoading(true);
        setSlides([]);
        setProgress(0);
        
        try {
            // 1. Generate presentation structure
            setProgressText('Analyzing your topic...');
            setProgress(10);
            
            const prompt = `You are an expert presentation creator. Generate a JSON array for an 8-slide presentation on the topic: "${topic}". The presentation must have a logical flow, including an introduction, key points, and a conclusion.`;
            const structureResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: slideSchema,
                },
            });
            setProgress(40);
            
            const generatedSlides: Slide[] = JSON.parse(structureResponse.text);
            setSlides(generatedSlides.map(s => ({...s, imageUrl: 'loading'})));

            // 2. Generate images for each slide
            setProgressText('Generating visuals...');
            const imagePromises = generatedSlides.map((slide, index) => 
                ai.models.generateImages({
                    model: 'imagen-4.0-generate-001',
                    prompt: slide.imagePrompt,
                    config: { numberOfImages: 1 }
                }).then(response => {
                    const newImageUrl = `data:image/png;base64,${response.generatedImages[0].image.imageBytes}`;
                    setSlides(prevSlides => {
                        const updatedSlides = [...prevSlides];
                        updatedSlides[index].imageUrl = newImageUrl;
                        return updatedSlides;
                    });
                    setProgress(prev => prev + (60 / generatedSlides.length));
                })
            );
            
            await Promise.all(imagePromises);
            
            setProgressText('Finalizing...');
            setProgress(100);
            setTimeout(() => setIsLoading(false), 500);

        } catch (error) {
            console.error("Error generating presentation:", error);
            setProgressText('An error occurred. Please try again.');
            setIsLoading(false);
        }
    };

    const handleExportToPDF = () => {
        setIsPrinting(true);
        // Timeout allows React to re-render with the print-specific layout before the print dialog opens.
        setTimeout(() => {
            window.print();
            setIsPrinting(false);
        }, 100);
    };

    const handleSlideUpdate = (index: number, field: 'title' | 'content', value: string) => {
        const updatedSlides = [...slides];
        if (field === 'title') {
            updatedSlides[index].title = value;
        } else {
            updatedSlides[index].content = value.split('\n');
        }
        setSlides(updatedSlides);
    };
    
    // Drag and drop functionality
    const dragItem = useRef<number | null>(null);
    const dragOverItem = useRef<number | null>(null);
    
    const handleDragSort = () => {
        if (dragItem.current === null || dragOverItem.current === null) return;
        
        const newSlides = [...slides];
        const draggedItemContent = newSlides.splice(dragItem.current, 1)[0];
        newSlides.splice(dragOverItem.current, 0, draggedItemContent);
        
        dragItem.current = null;
        dragOverItem.current = null;
        
        setSlides(newSlides);
        if(currentSlideIndex === dragItem.current) {
            setCurrentSlideIndex(dragOverItem.current);
        }
    };

    const renderContent = () => {
        if (isLoading) {
            return <LoadingScreen progress={progress} text={progressText} />;
        }
        if (slides.length === 0) {
            return <PromptScreen topic={topic} setTopic={setTopic} onGenerate={handleGeneratePresentation} />;
        }
        return (
            <PresentationScreen
                slides={slides}
                currentSlideIndex={currentSlideIndex}
                setCurrentSlideIndex={setCurrentSlideIndex}
                theme={theme}
                setTheme={setTheme}
                onExport={handleExportToPDF}
                onSlideUpdate={handleSlideUpdate}
                dragItem={dragItem}
                dragOverItem={dragOverItem}
                handleDragSort={handleDragSort}
            />
        );
    };

    const PrintLayout = () => (
        <div className="hidden-for-print">
            {slides.map((slide, index) => (
                <div key={index} className="slide-view">
                    <div className="slide-text-content">
                         <input
                            className="slide-title"
                            value={slide.title}
                            readOnly
                        />
                         <textarea
                            className="slide-body"
                            value={slide.content.join('\n')}
                            readOnly
                        />
                    </div>
                    <div className="slide-image-content">
                        {slide.imageUrl && slide.imageUrl !== 'loading' && <img src={slide.imageUrl} alt={slide.title} className="slide-image" />}
                    </div>
                </div>
            ))}
        </div>
    );


    return (
        <div className={`theme-${theme}`}>
            {isPrinting ? <PrintLayout /> : renderContent()}
        </div>
    );
};

const PromptScreen: React.FC<{ topic: string, setTopic: (t: string) => void, onGenerate: () => void }> = ({ topic, setTopic, onGenerate }) => (
    <div className="prompt-container">
        <h1>AI Presentation Generator</h1>
        <p>Enter a topic, and let AI create a stunning presentation for you in seconds.</p>
        <textarea
            className="prompt-input"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g., The Future of Renewable Energy"
        />
        <button onClick={onGenerate} disabled={!topic.trim()}>Generate Presentation</button>
    </div>
);

const LoadingScreen: React.FC<{ progress: number, text: string }> = ({ progress, text }) => (
    <div className="loading-container">
        <h2>Creating your presentation...</h2>
        <div className="progress-bar-container">
            <div className="progress-bar" style={{ width: `${progress}%` }}></div>
        </div>
        <p className="progress-text">{text}</p>
    </div>
);

const PresentationScreen: React.FC<{
    slides: Slide[],
    currentSlideIndex: number,
    setCurrentSlideIndex: (i: number) => void,
    theme: Theme,
    setTheme: (t: Theme) => void,
    onExport: () => void,
    onSlideUpdate: (index: number, field: 'title' | 'content', value: string) => void,
    dragItem: React.MutableRefObject<number | null>,
    dragOverItem: React.MutableRefObject<number | null>,
    handleDragSort: () => void,
}> = (props) => {
    const { slides, currentSlideIndex, setCurrentSlideIndex, theme, setTheme, onExport, onSlideUpdate, dragItem, dragOverItem, handleDragSort } = props;
    const currentSlide = slides[currentSlideIndex];

    return (
        <div className="presentation-container">
            <aside className="sidebar">
                <div className="slide-preview-list">
                    {slides.map((slide, index) => (
                        <div
                            key={index}
                            className={`slide-preview ${currentSlideIndex === index ? 'active' : ''}`}
                            onClick={() => setCurrentSlideIndex(index)}
                            draggable
                            onDragStart={() => dragItem.current = index}
                            onDragEnter={() => dragOverItem.current = index}
                            onDragEnd={handleDragSort}
                            onDragOver={(e) => e.preventDefault()}
                        >
                            <span className="slide-number">{index + 1}</span>
                            <div className="slide-preview-content">
                                <h3>{slide.title}</h3>
                            </div>
                        </div>
                    ))}
                </div>
            </aside>
            <main className="main-content">
                <div className="toolbar">
                    <div className="theme-selector">
                        <span>Theme:</span>
                        {THEMES.map(t => (
                            <button key={t.id} className={`theme-button ${theme === t.id ? 'active' : ''}`} onClick={() => setTheme(t.id)}>{t.name}</button>
                        ))}
                    </div>
                    <div className="export-options">
                        <button className="export-button" onClick={onExport}>
                            <svg fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2H6zm4 14a1 1 0 100-2 1 1 0 000 2zM8 5a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" clipRule="evenodd"></path></svg>
                            Export to PDF
                        </button>
                    </div>
                </div>
                <div className="slide-editor">
                    {currentSlide && (
                        <div className="slide-view">
                            <div className="slide-text-content">
                                <input
                                    className="slide-title"
                                    value={currentSlide.title}
                                    onChange={(e) => onSlideUpdate(currentSlideIndex, 'title', e.target.value)}
                                    aria-label="Slide Title"
                                />
                                <textarea
                                    className="slide-body"
                                    value={currentSlide.content.join('\n')}
                                    onChange={(e) => onSlideUpdate(currentSlideIndex, 'content', e.target.value)}
                                    aria-label="Slide Content"
                                />
                            </div>
                            <div className="slide-image-content">
                                {currentSlide.imageUrl === 'loading' ? (
                                    <div className="slide-image loading"><div className="spinner"></div></div>
                                ) : (
                                    <img src={currentSlide.imageUrl} alt={currentSlide.title} className="slide-image" />
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
