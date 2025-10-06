/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

// FIX: Corrected the React import statement by removing the typo 'aista,'.
import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";
import PptxGenJS from 'pptxgenjs';
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

const API_KEY = process.env.API_KEY;

type AppStep = 'prompt' | 'outline' | 'loading' | 'presentation';

type SlideLayout = 'text-left' | 'text-right' | 'image-full';

interface ChartData {
  type: 'bar' | 'line' | 'pie';
  labels: string[];
  datasets: {
    label: string;
    data: number[];
  }[];
}

interface Slide {
  title: string;
  content: string[];
  imagePrompt: string;
  imageUrl?: string;
  speakerNotes?: string;
  layout: SlideLayout;
  chartData?: ChartData;
}

interface Outline {
    title: string;
    points: string[];
}

type DefaultTheme = 'dark' | 'modern' | 'corporate' | 'minimal' | 'academic';

interface CustomTheme {
    id: string;
    name: string;
    colors: {
        '--bg-primary': string;
        '--bg-secondary': string;
        '--text-primary': string;
        '--text-secondary': string;
        '--accent-primary': string;
    };
}

const DEFAULT_THEMES: { id: DefaultTheme; name: string }[] = [
    { id: 'dark', name: 'Dark' },
    { id: 'modern', name: 'Modern' },
    { id: 'corporate', name: 'Corporate' },
    { id: 'minimal', name: 'Minimal' },
    { id: 'academic', name: 'Academic' },
];

const ai = new GoogleGenAI({ apiKey: API_KEY });

// --- Helper Schemas ---

const singleSlideSchema = {
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
      description: 'If a chart is NOT generated, provide a simple, descriptive prompt for an AI image generator. Otherwise, this can be empty.',
    },
    chart: {
        type: Type.OBJECT,
        description: "Optional. If the slide content is data-driven (e.g., comparisons, trends, percentages), generate a chart object. Otherwise, omit this field.",
        properties: {
          type: {
            type: Type.STRING,
            description: "The type of chart. Can be 'bar', 'line', or 'pie'.",
          },
          labels: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "The labels for the x-axis or pie slices.",
          },
          datasets: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING, description: "The name of this dataset (e.g., 'Market Share')." },
                data: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "The numerical data points." }
              },
              required: ["label", "data"]
            },
            description: "An array of datasets to be plotted."
          }
        },
        required: ["type", "labels", "datasets"]
      }
  },
  required: ["title", "content", "imagePrompt"],
};

const outlinesSchema = {
    type: Type.ARRAY,
    description: "An array of 2-3 distinct outline suggestions for the presentation.",
    items: {
        type: Type.OBJECT,
        properties: {
            title: {
                type: Type.STRING,
                description: "A short, thematic title for this outline approach (e.g., 'Problem-Solution Focused', 'Chronological Order')."
            },
            points: {
                type: Type.ARRAY,
                description: "An array of strings, where each string is a proposed title for a slide in the presentation.",
                items: { type: Type.STRING }
            }
        },
        required: ["title", "points"]
    }
};


// --- React Components ---

const App: React.FC = () => {
    const [appStep, setAppStep] = useState<AppStep>('prompt');
    const [topic, setTopic] = useState('');
    const [slideCount, setSlideCount] = useState(8);
    const [audience, setAudience] = useState('General Audience');
    
    const [progress, setProgress] = useState(0);
    const [progressText, setProgressText] = useState('');

    const [outlines, setOutlines] = useState<Outline[]>([]);
    const [selectedOutlineIndex, setSelectedOutlineIndex] = useState<number | null>(null);
    
    const [slides, setSlides] = useState<Slide[]>([]);
    const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
    
    const [theme, setTheme] = useState<string>('dark');
    const [isPrinting, setIsPrinting] = useState(false);
    const [isExportingPPTX, setIsExportingPPTX] = useState(false);
    const [isPresenting, setIsPresenting] = useState(false);
    const [slideActionLoading, setSlideActionLoading] = useState<{ [key: string]: boolean }>({});
    
    const [customThemes, setCustomThemes] = useState<CustomTheme[]>([]);
    const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);
    
    const [isShareModalOpen, setIsShareModalOpen] = useState(false);
    const [shareUrl, setShareUrl] = useState('');
    const [isReadOnlyView, setIsReadOnlyView] = useState(false);

    const appContainerRef = useRef<HTMLDivElement>(null);

    // Check for shared presentation data in URL on initial load
    useEffect(() => {
        try {
            const hash = window.location.hash;
            if (hash.startsWith('#share=')) {
                const encodedData = hash.substring(7);
                const decodedData = atob(encodedData);
                const payload = JSON.parse(decodedData);
                if (payload.slides && payload.theme) {
                    setSlides(payload.slides);
                    setTheme(payload.theme);
                    if (payload.customTheme) {
                        setCustomThemes(prev => {
                            const existing = prev.find(t => t.id === payload.customTheme.id);
                            return existing ? prev : [...prev, payload.customTheme];
                        });
                    }
                    setIsReadOnlyView(true);
                    setAppStep('presentation');
                }
            }
        } catch (error) {
            console.error("Failed to load shared presentation:", error);
            // Fallback to normal prompt screen
            window.location.hash = '';
        }
    }, []);

    // Load custom themes from local storage on initial render
    useEffect(() => {
        try {
            const savedThemes = localStorage.getItem('slideSparkCustomThemes');
            if (savedThemes) {
                setCustomThemes(JSON.parse(savedThemes));
            }
        } catch (error) {
            console.error("Failed to load custom themes from local storage:", error);
        }
    }, []);

    // Save custom themes to local storage whenever they change
    useEffect(() => {
        try {
            localStorage.setItem('slideSparkCustomThemes', JSON.stringify(customThemes));
        } catch (error) {
            console.error("Failed to save custom themes to local storage:", error);
        }
    }, [customThemes]);

    // Apply custom theme colors as CSS variables
    useEffect(() => {
        const customTheme = customThemes.find(t => t.id === theme);
        const container = appContainerRef.current;
        if (customTheme && container) {
            Object.entries(customTheme.colors).forEach(([key, value]) => {
                container.style.setProperty(key, value);
            });
        } else if (container) {
            // Clear inline styles if a default theme is selected
            container.style.cssText = '';
        }
    }, [theme, customThemes]);
    
    const setActionLoading = (action: string, index: number, value: boolean) => {
        setSlideActionLoading(prev => ({ ...prev, [`${action}-${index}`]: value }));
    };

    const handleStartOver = () => {
        // If it's a shared link, reload to go to the prompt. Otherwise, just reset state.
        if(isReadOnlyView || window.location.hash.startsWith('#share=')) {
            window.location.href = window.location.pathname;
        } else {
            setSlides([]);
            setOutlines([]);
            setSelectedOutlineIndex(null);
            setCurrentSlideIndex(0);
            setAppStep('prompt');
        }
    };

    const handlePublish = () => {
        try {
            const customThemeForShare = customThemes.find(t => t.id === theme);
            const payload = {
                slides: slides,
                theme: theme,
                customTheme: customThemeForShare || null,
            };
            const data = JSON.stringify(payload);
            const encodedData = btoa(data);
            const url = `${window.location.origin}${window.location.pathname}#share=${encodedData}`;
            setShareUrl(url);
            setIsShareModalOpen(true);
        } catch (error) {
            console.error("Failed to create share link:", error);
            alert("Could not create a shareable link. The presentation might be too large.");
        }
    };

    const handleGenerateOutlines = async () => {
        if (!topic.trim()) return;
        setAppStep('loading');
        setProgress(0);
        setProgressText('Brainstorming presentation structures...');
        
        try {
            const prompt = `You are an expert presentation strategist. For a presentation on "${topic}" aimed at a "${audience}" audience, generate 2-3 distinct outlines. Each outline should have a thematic title and exactly ${slideCount} slide titles as points, ensuring a logical flow from introduction to conclusion.`;
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: outlinesSchema,
                },
            });
            setProgress(100);
            
            const generatedOutlines: Outline[] = JSON.parse(response.text);
            setOutlines(generatedOutlines);
            setSelectedOutlineIndex(0);
            setAppStep('outline');

        } catch (error) {
            console.error("Error generating outlines:", error);
            setProgressText('An error occurred. Please try again.');
            setTimeout(() => setAppStep('prompt'), 2000);
        }
    };

    const handleGenerateSlidesFromOutline = async () => {
        if (selectedOutlineIndex === null) return;
        const selectedOutline = outlines[selectedOutlineIndex];
        
        setAppStep('loading');
        setProgress(0);
        setSlides([]);

        try {
            const totalSteps = selectedOutline.points.length * 2; // content + visual (image or chart)
            let currentStep = 0;

            const initialSlides: Slide[] = selectedOutline.points.map(title => ({
                title: title,
                content: [],
                imagePrompt: '',
                layout: 'text-left',
                speakerNotes: '',
                imageUrl: 'pending'
            }));
            setSlides(initialSlides);

            for (let i = 0; i < selectedOutline.points.length; i++) {
                const slideTitle = selectedOutline.points[i];
                setProgressText(`Generating content for: "${slideTitle}"`);

                const prompt = `You are a presentation content creator. For a presentation on "${topic}", generate the content for a slide with the title "${slideTitle}". Provide 2-4 concise bullet points. **Crucially, if the content is data-centric (like statistics, comparisons, or trends), generate a chart object. Otherwise, provide an image prompt for a relevant visual.** You should prioritize generating a chart over an image for any data visualization.`;
                const contentResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt,
                    config: {
                        responseMimeType: 'application/json',
                        responseSchema: singleSlideSchema
                    }
                });
                currentStep++;
                setProgress((currentStep / totalSteps) * 100);

                const { content, imagePrompt, chart } = JSON.parse(contentResponse.text);

                if (chart) {
                    setSlides(prev => {
                        const updated = [...prev];
                        updated[i] = { ...updated[i], content, imagePrompt, chartData: chart, imageUrl: undefined };
                        return updated;
                    });
                    currentStep++; // Skip image step
                    setProgress((currentStep / totalSteps) * 100);
                    continue; // Go to next slide
                }
                
                setSlides(prev => {
                    const updated = [...prev];
                    updated[i] = { ...updated[i], content, imagePrompt, imageUrl: 'loading' };
                    return updated;
                });
                
                setProgressText(`Generating image for: "${slideTitle}"`);
                try {
                    const imageResponse = await ai.models.generateImages({
                        model: 'imagen-4.0-generate-001',
                        prompt: imagePrompt,
                        config: { numberOfImages: 1 }
                    });
                    const newImageUrl = `data:image/png;base64,${imageResponse.generatedImages[0].image.imageBytes}`;
                     setSlides(prev => {
                        const updated = [...prev];
                        if(updated[i]) updated[i].imageUrl = newImageUrl;
                        return updated;
                    });
                } catch (err) {
                    console.error(`Failed to generate image for slide ${i}:`, err);
                     setSlides(prev => {
                        const updated = [...prev];
                        if(updated[i]) updated[i].imageUrl = 'error';
                        return updated;
                    });
                }
                currentStep++;
                setProgress((currentStep / totalSteps) * 100);
            }
            
            setProgressText('Finalizing...');
            setProgress(100);
            setTimeout(() => setAppStep('presentation'), 500);

        } catch (error) {
            console.error("Error generating presentation:", error);
            setProgressText('An error occurred. Please try again.');
            setTimeout(() => setAppStep('outline'), 2000);
        }
    };
    
    const handleRegenerateImage = async (index: number) => {
        if (!slides[index] || isReadOnlyView) return;
        setActionLoading('image', index, true);
        
        const newSlides = [...slides];
        newSlides[index].imageUrl = 'loading';
        setSlides(newSlides);

        try {
            const response = await ai.models.generateImages({
                model: 'imagen-4.0-generate-001',
                prompt: slides[index].imagePrompt,
                config: { numberOfImages: 1 }
            });
            const newImageUrl = `data:image/png;base64,${response.generatedImages[0].image.imageBytes}`;
            setSlides(prev => {
                const updated = [...prev];
                updated[index].imageUrl = newImageUrl;
                updated[index].chartData = undefined; // Ensure chart is removed
                return updated;
            });
        } catch (error) {
            console.error("Error regenerating image:", error);
            setSlides(prev => {
                const updated = [...prev];
                updated[index].imageUrl = 'error';
                return updated;
            });
        } finally {
            setActionLoading('image', index, false);
        }
    };
    
    const handleRegenerateChart = async (index: number) => {
        if (isReadOnlyView) return;
        setActionLoading('chart', index, true);
        try {
            const currentSlide = slides[index];
            const prompt = `Generate only chart data for a presentation slide about "${topic}".
            Slide Title: "${currentSlide.title}"
            Slide Content: - ${currentSlide.content.join('\n- ')}
            The chart should visualize the key information in the slide content. Respond with only the JSON chart object.`;
            
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: { chart: singleSlideSchema.properties.chart },
                        required: ["chart"]
                    }
                }
            });
            const { chart } = JSON.parse(response.text);
            if (chart) {
                setSlides(prev => {
                    const updated = [...prev];
                    updated[index].chartData = chart;
                    updated[index].imageUrl = undefined;
                    return updated;
                });
            }
        } catch (error) {
            console.error("Error regenerating chart:", error);
        } finally {
            setActionLoading('chart', index, false);
        }
    };
    
    const handleRegenerateSlideContent = async (index: number) => {
        if (isReadOnlyView) return;
        setActionLoading('content', index, true);
        try {
            const prompt = `You are a presentation expert. Regenerate content for a single slide. The presentation topic is "${topic}". The original slide title was "${slides[index].title}". Provide a new title, 2-4 bullet points, and either a new image prompt OR new chart data if the content is data-centric.`;
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: singleSlideSchema,
                }
            });
            const newSlideContent = JSON.parse(response.text);
            const { chart, imagePrompt } = newSlideContent;
            
            setSlides(prev => {
                const updated = [...prev];
                updated[index] = { ...updated[index], ...newSlideContent, chartData: chart, imageUrl: chart ? undefined : 'loading' };
                return updated;
            });

            if (!chart) {
                await handleRegenerateImage(index);
            }

        } catch (error) {
            console.error("Error regenerating slide content:", error);
        } finally {
            setActionLoading('content', index, false);
        }
    };
    
    const handleEnhanceSlide = async (index: number) => {
        if (isReadOnlyView) return;
        setActionLoading('enhance', index, true);
        try {
            const currentSlide = slides[index];
            const prompt = `Rewrite the following slide content to be more clear, concise, and engaging for a ${audience} audience. Keep the meaning the same but improve the wording. Do not add any introductory text, just the rewritten content.
            
            Original content:
            Title: "${currentSlide.title}"
            Body: "${currentSlide.content.join('\n- ')}"

            Return ONLY the rewritten text in the format:
            Title: [new title]
            - [bullet 1]
            - [bullet 2]
            ...`;
            
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });
            
            const responseText = response.text;
            const lines = responseText.split('\n').filter(line => line.trim() !== '');
            const newTitle = lines.find(line => line.toLowerCase().startsWith('title:'))?.replace(/title:/i, '').trim() || currentSlide.title;
            const newContent = lines.filter(line => line.trim().startsWith('-')).map(line => line.trim().substring(1).trim());

            if (newContent.length > 0) {
                 setSlides(prev => {
                    const updated = [...prev];
                    updated[index].title = newTitle;
                    updated[index].content = newContent;
                    return updated;
                });
            } else {
                console.warn("Failed to parse enhanced content:", responseText);
            }
        } catch (error) {
            console.error("Error enhancing slide:", error);
        } finally {
            setActionLoading('enhance', index, false);
        }
    };

    const handleGenerateSpeakerNotes = async (index: number) => {
        if (isReadOnlyView) return;
        setActionLoading('notes', index, true);
        try {
            const currentSlide = slides[index];
            const prompt = `Generate concise speaker notes for a presentation slide.
            Topic: "${topic}"
            Audience: ${audience}
            Slide Title: "${currentSlide.title}"
            Slide Content:
            - ${currentSlide.content.join('\n- ')}

            The notes should provide talking points, key insights, and potential questions to engage the audience. Format as bullet points.`;
            
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
            handleUpdateSlide(index, 'speakerNotes', response.text);
        } catch (error) {
            console.error("Error generating speaker notes:", error);
        } finally {
            setActionLoading('notes', index, false);
        }
    };

    const handleExportToPDF = () => {
        setIsPrinting(true);
        setTimeout(() => {
            window.print();
            setIsPrinting(false);
        }, 100);
    };
    
    const handleExportToPPTX = async () => {
        setIsExportingPPTX(true);
        try {
            const pptx = new PptxGenJS();
            pptx.layout = 'LAYOUT_16x9';

            const isDarkTheme = theme === 'dark' || (customThemes.find(t => t.id === theme)?.colors['--bg-primary'] || '#ffffff').toLowerCase() < '#888888';
            const defaultTextColor = isDarkTheme ? 'FFFFFF' : '000000';
            const defaultBgColor = isDarkTheme ? '121212' : 'FDFBF7';
            
            for (const slide of slides) {
                const pptxSlide = pptx.addSlide();
                pptxSlide.background = { color: defaultBgColor };

                let titleOpts: PptxGenJS.TextPropsOptions = {
                    x: 0.5, y: 0.25, w: '90%', h: 1,
                    fontSize: 32,
                    bold: true,
                    color: defaultTextColor,
                    align: 'center',
                };
                
                let bodyOpts: PptxGenJS.TextPropsOptions = {
                    x: 0.5, y: 1.5, w: '90%', h: 3.5,
                    fontSize: 18,
                    color: defaultTextColor,
                    bullet: true,
                };
                
                const hasValidImage = slide.imageUrl && slide.imageUrl.startsWith('data:image');

                if (slide.chartData) {
                    const chartTypeMap: {[key:string]: PptxGenJS.ChartType} = {
                        'bar': pptx.charts.BAR,
                        'line': pptx.charts.LINE,
                        'pie': pptx.charts.PIE,
                    };
                    const chartType = chartTypeMap[slide.chartData.type] || pptx.charts.BAR;
                    const pptxChartData = slide.chartData.datasets.map(ds => ({
                        name: ds.label,
                        labels: slide.chartData.labels,
                        values: ds.data
                    }));
                    
                    let chartOpts: any = { x: 0.5, y: 1.5, w: '90%', h: '65%', showLegend: true, legendPos: 'b', showLabel: true };
                    if(slide.layout !== 'image-full') {
                        chartOpts.w = '45%';
                        const textW = '45%';
                        const textX = slide.layout === 'text-left' ? 0.5 : '50%';
                        chartOpts.x = slide.layout === 'text-left' ? '50%' : 0.5;
                        titleOpts = {...titleOpts, w: textW, x: textX, align: 'left'};
                        bodyOpts = {...bodyOpts, w: textW, x: textX};
                    }
                    pptxSlide.addChart(chartType, pptxChartData, chartOpts);

                } else if (slide.layout === 'image-full' && hasValidImage) {
                    pptxSlide.background = { data: slide.imageUrl };
                    titleOpts.color = 'FFFFFF';
                    bodyOpts.color = 'FFFFFF';
                    titleOpts.x = '5%';
                    bodyOpts.x = '5%';
                } else if (hasValidImage) {
                    // FIX: Define imgX based on slide layout to correctly position the image.
                    const imgX = slide.layout === 'text-left' ? '50%' : 0.5;
                    pptxSlide.addImage({ data: slide.imageUrl, x: imgX, y: 1.5, w: '45%', h: '60%' });
                    const textW = '45%';
                    const textX = slide.layout === 'text-left' ? 0.5 : '50%';
                    titleOpts = {...titleOpts, w: textW, x: textX, align: 'left'};
                    bodyOpts = {...bodyOpts, w: textW, x: textX};
                }

                pptxSlide.addText(slide.title, titleOpts);
                pptxSlide.addText(slide.content.join('\n'), bodyOpts);
            }
            
            const baseName = topic || (slides.length > 0 ? slides[0].title : 'presentation');
            const safeFileName = baseName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            await pptx.writeFile({ fileName: `${safeFileName}.pptx` });

        } catch (error) {
            console.error("Error exporting to PPTX:", error);
        } finally {
            setIsExportingPPTX(false);
        }
    };

    const handleUpdateSlide = (index: number, field: keyof Slide, value: any) => {
        if(isReadOnlyView) return;
        const updatedSlides = [...slides];
        updatedSlides[index] = { ...updatedSlides[index], [field]: value };
        setSlides(updatedSlides);
    };

    const handleAddSlide = () => {
        if(isReadOnlyView) return;
        const newSlide: Slide = {
            title: 'New Slide',
            content: ['Click to edit content.'],
            imagePrompt: 'A simple background image',
            layout: 'text-left',
            imageUrl: undefined,
            speakerNotes: ''
        };
        const newSlides = [...slides, newSlide];
        setSlides(newSlides);
        setCurrentSlideIndex(newSlides.length - 1);
    };

    const handleDeleteSlide = (index: number) => {
        if (slides.length <= 1 || isReadOnlyView) return; // Don't delete the last slide
        const newSlides = slides.filter((_, i) => i !== index);
        setSlides(newSlides);
        if (currentSlideIndex >= index) {
            setCurrentSlideIndex(Math.max(0, currentSlideIndex - 1));
        }
    };
    
    const dragItem = useRef<number | null>(null);
    const dragOverItem = useRef<number | null>(null);
    
    const handleDragSort = () => {
        if (dragItem.current === null || dragOverItem.current === null || dragItem.current === dragOverItem.current || isReadOnlyView) return;
        
        let newSlides = [...slides];
        const draggedItemContent = newSlides.splice(dragItem.current, 1)[0];
        newSlides.splice(dragOverItem.current, 0, draggedItemContent);
        
        let newCurrentIndex = currentSlideIndex;
        if (currentSlideIndex === dragItem.current) {
            newCurrentIndex = dragOverItem.current;
        } else if (dragItem.current < currentSlideIndex && dragOverItem.current >= currentSlideIndex) {
            newCurrentIndex--;
        } else if (dragItem.current > currentSlideIndex && dragOverItem.current <= currentSlideIndex) {
            newCurrentIndex++;
        }
        
        dragItem.current = null;
        dragOverItem.current = null;
        
        setSlides(newSlides);
        setCurrentSlideIndex(newCurrentIndex);
    };

    const handleSaveCustomTheme = (newTheme: CustomTheme) => {
        setCustomThemes(prev => [...prev, newTheme]);
        setTheme(newTheme.id);
        setIsThemeModalOpen(false);
    };

    const handleDeleteCustomTheme = (themeId: string) => {
        if(theme === themeId) {
            setTheme('dark'); // Fallback to default
        }
        setCustomThemes(prev => prev.filter(t => t.id !== themeId));
    };

    const renderContent = () => {
        if (isReadOnlyView) {
             return (
                    <PresentationScreen
                        slides={slides}
                        currentSlideIndex={currentSlideIndex}
                        setCurrentSlideIndex={setCurrentSlideIndex}
                        theme={theme}
                        setTheme={setTheme}
                        customThemes={customThemes}
                        onDeleteCustomTheme={handleDeleteCustomTheme}
                        onOpenThemeModal={() => setIsThemeModalOpen(true)}
                        onExportToPDF={handleExportToPDF}
                        onExportToPPTX={handleExportToPPTX}
                        isExportingPPTX={isExportingPPTX}
                        onUpdateSlide={handleUpdateSlide}
                        dragItem={dragItem}
                        dragOverItem={dragOverItem}
                        handleDragSort={handleDragSort}
                        onRegenerateImage={handleRegenerateImage}
                        onRegenerateChart={handleRegenerateChart}
                        onRegenerateContent={handleRegenerateSlideContent}
                        onEnhance={handleEnhanceSlide}
                        slideActionLoading={slideActionLoading}
                        onGenerateSpeakerNotes={handleGenerateSpeakerNotes}
                        onAddSlide={handleAddSlide}
                        onDeleteSlide={handleDeleteSlide}
                        onPresent={() => setIsPresenting(true)}
                        onStartOver={handleStartOver}
                        onPublish={handlePublish}
                        isReadOnlyView={isReadOnlyView}
                    />
                );
        }

        switch (appStep) {
            case 'prompt':
                return <PromptScreen 
                    topic={topic} setTopic={setTopic} 
                    onGenerate={handleGenerateOutlines} 
                    slideCount={slideCount} setSlideCount={setSlideCount}
                    audience={audience} setAudience={setAudience}
                />;
            case 'outline':
                 return <OutlineScreen
                    outlines={outlines}
                    setOutlines={setOutlines}
                    selectedOutlineIndex={selectedOutlineIndex}
                    setSelectedOutlineIndex={setSelectedOutlineIndex}
                    onGenerateSlides={handleGenerateSlidesFromOutline}
                    onBack={() => setAppStep('prompt')}
                />;
            case 'loading':
                 return <LoadingScreen progress={progress} text={progressText} />;
            case 'presentation':
                 return (
                    <PresentationScreen
                        slides={slides}
                        currentSlideIndex={currentSlideIndex}
                        setCurrentSlideIndex={setCurrentSlideIndex}
                        theme={theme}
                        setTheme={setTheme}
                        customThemes={customThemes}
                        onDeleteCustomTheme={handleDeleteCustomTheme}
                        onOpenThemeModal={() => setIsThemeModalOpen(true)}
                        onExportToPDF={handleExportToPDF}
                        onExportToPPTX={handleExportToPPTX}
                        isExportingPPTX={isExportingPPTX}
                        onUpdateSlide={handleUpdateSlide}
                        dragItem={dragItem}
                        dragOverItem={dragOverItem}
                        handleDragSort={handleDragSort}
                        onRegenerateImage={handleRegenerateImage}
                        onRegenerateChart={handleRegenerateChart}
                        onRegenerateContent={handleRegenerateSlideContent}
                        onEnhance={handleEnhanceSlide}
                        slideActionLoading={slideActionLoading}
                        onGenerateSpeakerNotes={handleGenerateSpeakerNotes}
                        onAddSlide={handleAddSlide}
                        onDeleteSlide={handleDeleteSlide}
                        onPresent={() => setIsPresenting(true)}
                        onStartOver={handleStartOver}
                        onPublish={handlePublish}
                        isReadOnlyView={isReadOnlyView}
                    />
                );
            default:
                return null;
        }
    };

    if (isPresenting) {
        return <PresentationView slides={slides} initialIndex={currentSlideIndex} onExit={() => setIsPresenting(false)} />;
    }

    const PrintLayout = () => (
        <div className="print-layout">
            {slides.map((slide, index) => (
                <div key={index} className={`slide-view print-slide layout-${slide.layout}`}>
                    <div className="slide-text-content">
                         <div className="slide-title">{slide.title}</div>
                         <ul className="slide-body">
                            {slide.content.map((point, i) => <li key={i}>{point}</li>)}
                         </ul>
                    </div>
                    <div className="slide-image-content">
                        {slide.chartData ? (
                            <ChartComponent data={slide.chartData} theme={theme} />
                        ) : slide.imageUrl && slide.imageUrl !== 'loading' && <img src={slide.imageUrl} alt={slide.imagePrompt} className="slide-image" />}
                    </div>
                </div>
            ))}
        </div>
    );

    const isCustomTheme = customThemes.some(t => t.id === theme);
    const themeClassName = isCustomTheme ? 'theme-custom' : `theme-${theme}`;

    return (
        <div ref={appContainerRef} className={`${themeClassName} app-container`}>
            {isPrinting ? <PrintLayout /> : renderContent()}
            {isThemeModalOpen && <ThemeCreatorModal onSave={handleSaveCustomTheme} onClose={() => setIsThemeModalOpen(false)} />}
            {isShareModalOpen && <ShareModal url={shareUrl} onClose={() => setIsShareModalOpen(false)} />}
        </div>
    );
};

const Icon = ({ name }: { name: string }) => {
    const icons: { [key: string]: React.ReactNode } = {
        logo: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5-10-5-10 5zM12 13.6l-10-5v6.8l10 5 10-5v-6.8l-10 5z"></path></svg>,
        add: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" /></svg>,
        trash: <svg viewBox="0 0 16 16" fill="currentColor"><path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.71l.5 5a.75.75 0 1 1-1.498.14l-.5-5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.5 5a.75.75 0 1 1-1.498-.14l.5-5A.75.75 0 0 1 9.95 6Z" clipRule="evenodd" /></svg>,
        present: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M3.5 3A1.5 1.5 0 0 0 2 4.5v2.5a.75.75 0 0 0 1.5 0V5h1.5a.75.75 0 0 0 0-1.5H3.5ZM15 3.5a.75.75 0 0 0 0 1.5H16.5v2a.75.75 0 0 0 1.5 0V4.5A1.5 1.5 0 0 0 16.5 3H15Zm-1.5 12a.75.75 0 0 0-1.5 0V15H5a.75.75 0 0 0 0 1.5h8.5Zm3-1.5a.75.75 0 0 0 0-1.5H15v-2a.75.75 0 0 0-1.5 0v2.5a1.5 1.5 0 0 0 1.5 1.5h1.5ZM3.5 12a.75.75 0 0 0 1.5 0v-2H6.5a.75.75 0 0 0 0-1.5H3.5a1.5 1.5 0 0 0-1.5 1.5v2.5Z" /></svg>,
        export: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" /><path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" /></svg>,
        share: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M13 4.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM8.5 6A3.5 3.5 0 1 0 5 2.5 3.5 3.5 0 0 0 8.5 6ZM13.03 12.22a.75.75 0 1 0-1.06-1.06l-2.72 2.72-1.69-1.69a.75.75 0 0 0-1.06 1.06l2.22 2.22a.75.75 0 0 0 1.06 0l3.25-3.25Z" /><path d="M11.5 9.25a.75.75 0 0 0 0 1.5h.25a2.75 2.75 0 0 1 2.75 2.75v.5a.75.75 0 0 0 1.5 0v-.5A4.25 4.25 0 0 0 11.75 9h-.25a.75.75 0 0 0-.75.75Z" /></svg>,
        chevronDown: <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>,
        regenerateImage: <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M1 8a7 7 0 1114 0A7 7 0 011 8zm15 0A8 8 0 110 8a8 8 0 0116 0zm-5.904 2.854a.75.75 0 11-1.192-.908 3.5 3.5 0 004.813-2.13.75.75 0 011.378.6A5 5 0 018.9 12.23a.75.75 0 01.904-1.185z" clipRule="evenodd" /></svg>,
        chart: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M15.5 2A1.5 1.5 0 0 0 14 3.5v13A1.5 1.5 0 0 0 15.5 18h.5a.75.75 0 0 0 0-1.5h-.5a.5.5 0 0 1-.5-.5v-12a.5.5 0 0 1 .5-.5h.5a.75.75 0 0 0 0-1.5h-.5ZM9.5 6A1.5 1.5 0 0 0 8 7.5v9A1.5 1.5 0 0 0 9.5 18h.5a.75.75 0 0 0 0-1.5h-.5a.5.5 0 0 1-.5-.5v-8a.5.5 0 0 1 .5-.5h.5a.75.75 0 0 0 0-1.5h-.5ZM3.5 10A1.5 1.5 0 0 0 2 11.5v5A1.5 1.5 0 0 0 3.5 18h.5a.75.75 0 0 0 0-1.5h-.5a.5.5 0 0 1-.5-.5v-4a.5.5 0 0 1 .5-.5h.5a.75.75 0 0 0 0-1.5h-.5Z" /></svg>,
        regenerateContent: <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.2 5.042.75.75 0 01-.212-1.062 6.96 6.96 0 00-.29-3.417 6.96 6.96 0 00-1.637-2.942.75.75 0 111.13-1.002a5.48 5.48 0 011.583 2.785 5.48 5.48 0 012.872 4.41.75.75 0 001.423-.425 5.5 5.5 0 01-.22-1.996.75.75 0 01.968-.732A5.5 5.5 0 0115.312 11.424zM16.5 7.5a.75.75 0 00-1.5 0v1.313a7.001 7.001 0 00-11.45 2.15.75.75 0 001.13 1.001A5.501 5.501 0 0115 8.813V7.5z" clipRule="evenodd" /><path d="M5.44 5.25A.75.75 0 016 4.5h5.25a.75.75 0 010 1.5H7.313a5.523 5.523 0 01-1.873 7.028.75.75 0 11-1.13-1.001A7.023 7.023 0 005.44 5.25z" /></svg>,
        enhance: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10.03 2.25a.75.75 0 01.75.75v1.251a3.266 3.266 0 010 1.298V7.5a.75.75 0 01-1.5 0V5.55a1.766 1.766 0 000-.798V3a.75.75 0 01.75-.75zM6.632 6.632a.75.75 0 011.06 0l.708.707a3.268 3.268 0 01.918.918l.707.708a.75.75 0 11-1.06 1.06l-.707-.707a1.768 1.768 0 00-.49-.49l-.708-.707a.75.75 0 010-1.06z" /><path d="M12.428 12.428a.75.75 0 011.06 1.06l-.707.707a1.768 1.768 0 00-.49.49l-.707.708a.75.75 0 01-1.06-1.06l.707-.707c.107-.107.222-.21.342-.307a3.268 3.268 0 01.576-.411z" /><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm0 1.5a9.5 9.5 0 100-19 9.5 9.5 0 000 19z" clipRule="evenodd" /></svg>,
        notes: <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.5 2A1.5 1.5 0 0 0 3 3.5v13A1.5 1.5 0 0 0 4.5 18h11a1.5 1.5 0 0 0 1.5-1.5V7.621a1.5 1.5 0 0 0-.44-1.06l-4.12-4.122A1.5 1.5 0 0 0 11.378 2H4.5ZM10 8a.75.75 0 0 1 .75.75v.008a.75.75 0 0 1-1.5 0V8.75A.75.75 0 0 1 10 8Zm.75 2.25a.75.75 0 0 0-1.5 0v2.5a.75.75 0 0 0 1.5 0v-2.5Z" clipRule="evenodd" /></svg>,
        layoutLeft: <svg viewBox="0 0 24 24"><rect x="2" y="4" width="10" height="16" fill="currentColor" opacity="0.4"></rect><rect x="14" y="4" width="8" height="16" fill="currentColor"></rect></svg>,
        layoutRight: <svg viewBox="0 0 24 24"><rect x="2" y="4" width="8" height="16" fill="currentColor"></rect><rect x="12" y="4" width="10" height="16" fill="currentColor" opacity="0.4"></rect></svg>,
        layoutFull: <svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" fill="currentColor"></rect><rect x="5" y="10" width="14" height="4" fill="currentColor" opacity="0.4"></rect></svg>,
        exit: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>,
        back: <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.78 5.22a.75.75 0 0 1 0 1.06L9.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" /></svg>,
        startOver: <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.2 5.042.75.75 0 0 1-.212-1.062 6.96 6.96 0 0 0-.29-3.417 6.96 6.96 0 0 0-1.637-2.942.75.75 0 1 1 1.13-1.002 5.48 5.48 0 0 1 1.583 2.785 5.48 5.48 0 0 1 2.872 4.41.75.75 0 0 0 1.423-.425 5.5 5.5 0 0 1-.22-1.996.75.75 0 0 1 .968-.732A5.5 5.5 0 0 1 15.312 11.424zM16.5 7.5a.75.75 0 0 0-1.5 0v1.313a7.001 7.001 0 0 0-11.45 2.15.75.75 0 0 0 1.13 1.001A5.501 5.501 0 0 1 15 8.813V7.5z" clipRule="evenodd" /><path d="M5.44 5.25A.75.75 0 0 1 6 4.5h5.25a.75.75 0 0 1 0 1.5H7.313a5.523 5.523 0 0 1-1.873 7.028.75.75 0 1 1-1.13-1.001A7.023 7.023 0 0 0 5.44 5.25z" /></svg>,
    };
    return <>{icons[name] || null}</>;
};

const PromptScreen: React.FC<{ 
    topic: string, setTopic: (t: string) => void, onGenerate: () => void,
    slideCount: number, setSlideCount: (n: number) => void,
    audience: string, setAudience: (a: string) => void,
}> = ({ topic, setTopic, onGenerate, slideCount, setSlideCount, audience, setAudience }) => {
    return (
        <div className="prompt-container">
            <div className="app-logo large">
                <Icon name="logo" />
                <h1>SlideSpark AI</h1>
            </div>
            <p>Enter a topic, and let our AI create a stunning presentation for you in seconds.</p>
            <textarea
                className="prompt-input"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g., The Future of Renewable Energy"
                aria-label="Presentation Topic"
            />
            <div className="advanced-options">
                <div className="form-group">
                    <label htmlFor="slide-count">Number of Slides: {slideCount}</label>
                    <input 
                        type="range" 
                        id="slide-count" 
                        min="5" 
                        max="15" 
                        value={slideCount}
                        onChange={(e) => setSlideCount(Number(e.target.value))} 
                    />
                </div>
                <div className="form-group">
                    <label htmlFor="audience">Target Audience</label>
                    <input 
                        type="text" 
                        id="audience" 
                        value={audience}
                        onChange={(e) => setAudience(e.target.value)}
                        placeholder="e.g., Business Professionals"
                    />
                </div>
            </div>
            <button className="generate-btn" onClick={onGenerate} disabled={!topic.trim()}>Suggest Outlines</button>
        </div>
    );
};

const OutlineScreen: React.FC<{
    outlines: Outline[],
    setOutlines: (o: Outline[]) => void,
    selectedOutlineIndex: number | null,
    setSelectedOutlineIndex: (i: number) => void,
    onGenerateSlides: () => void,
    onBack: () => void,
}> = ({ outlines, setOutlines, selectedOutlineIndex, setSelectedOutlineIndex, onGenerateSlides, onBack }) => {

    const handlePointChange = (outlineIndex: number, pointIndex: number, value: string) => {
        const newOutlines = [...outlines];
        newOutlines[outlineIndex].points[pointIndex] = value;
        setOutlines(newOutlines);
    };

    return (
        <div className="outline-container">
            <button onClick={onBack} className="back-btn"><Icon name="back" /> Back to topic</button>
            <h2>Choose a Structure</h2>
            <p>Select an outline below, or edit the slide titles to fit your needs.</p>
            <div className="outlines-grid">
                {outlines.map((outline, index) => (
                    <div 
                        key={index} 
                        className={`outline-card ${selectedOutlineIndex === index ? 'active' : ''}`}
                        onClick={() => setSelectedOutlineIndex(index)}
                    >
                        <h3>{outline.title}</h3>
                        <ul className="outline-points">
                            {outline.points.map((point, pIndex) => (
                                <li key={pIndex}>
                                    <input 
                                        type="text"
                                        value={point}
                                        onChange={(e) => handlePointChange(index, pIndex, e.target.value)}
                                        readOnly={selectedOutlineIndex !== index}
                                    />
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>
            <button className="generate-btn" onClick={onGenerateSlides} disabled={selectedOutlineIndex === null}>
                Generate Slides
            </button>
        </div>
    );
};

const LoadingScreen: React.FC<{ progress: number, text: string }> = ({ progress, text }) => (
    <div className="loading-container">
        <h2>Creating your masterpiece...</h2>
        <div className="progress-bar-container">
            <div className="progress-bar" style={{ width: `${progress}%` }}></div>
        </div>
        <p className="progress-text">{text}</p>
    </div>
);

const ChartComponent: React.FC<{ data: ChartData; theme: string }> = ({ data, theme }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const chartRef = useRef<Chart | null>(null);

    useEffect(() => {
        if (!canvasRef.current) return;
        
        if (chartRef.current) {
            chartRef.current.destroy();
        }

        const style = getComputedStyle(document.body);
        const textColor = style.getPropertyValue('--text-secondary');
        const gridColor = style.getPropertyValue('--border-color');
        const accentColor = style.getPropertyValue('--accent-primary');

        const chartColors = [
            accentColor, '#ec4899', '#3b82f6', '#f97316', '#14b8a6', '#8b5cf6'
        ];

        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
            chartRef.current = new Chart(ctx, {
                type: data.type,
                data: {
                    labels: data.labels,
                    datasets: data.datasets.map((ds, i) => ({
                        ...ds,
                        backgroundColor: data.type === 'pie' ? chartColors : chartColors[i % chartColors.length],
                        borderColor: data.type === 'line' ? chartColors[i % chartColors.length] : 'transparent',
                        borderWidth: data.type === 'line' ? 2 : 1,
                    }))
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { labels: { color: textColor, font: { family: "'Inter', sans-serif" } } },
                        tooltip: { titleFont: { family: "'Inter', sans-serif" }, bodyFont: { family: "'Inter', sans-serif" } }
                    },
                    scales: data.type !== 'pie' ? {
                        y: { ticks: { color: textColor, font: { family: "'Inter', sans-serif" } }, grid: { color: gridColor } },
                        x: { ticks: { color: textColor, font: { family: "'Inter', sans-serif" } }, grid: { color: gridColor } }
                    } : {}
                }
            });
        }
        
        return () => {
            if (chartRef.current) {
                chartRef.current.destroy();
            }
        };
    }, [data, theme]);

    return (
        <div className="chart-container">
            <canvas ref={canvasRef}></canvas>
        </div>
    );
};


const Header: React.FC<{
    theme: string,
    setTheme: (t: string) => void,
    customThemes: CustomTheme[],
    onDeleteCustomTheme: (id: string) => void,
    onOpenThemeModal: () => void,
    onPresent: () => void,
    onExportToPDF: () => void,
    onExportToPPTX: () => void,
    isExportingPPTX: boolean,
    onStartOver: () => void,
    onPublish: () => void,
    isReadOnlyView: boolean
}> = ({ theme, setTheme, customThemes, onDeleteCustomTheme, onOpenThemeModal, onPresent, onExportToPDF, onExportToPPTX, isExportingPPTX, onStartOver, onPublish, isReadOnlyView }) => {
    const [showExportDropdown, setShowExportDropdown] = useState(false);
    const [showThemeDropdown, setShowThemeDropdown] = useState(false);
    const exportRef = useRef<HTMLDivElement>(null);
    const themeRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (exportRef.current && !exportRef.current.contains(event.target as Node)) {
                setShowExportDropdown(false);
            }
            if (themeRef.current && !themeRef.current.contains(event.target as Node)) {
                setShowThemeDropdown(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const renderThemeCard = (t: {id: string, name: string}, isCustom = false) => (
        <div key={t.id} title={t.name} className={`theme-card-wrapper`}>
            <div className={`theme-card theme-card-${t.id} ${theme === t.id ? 'active' : ''}`} onClick={() => setTheme(t.id)}>
                {isCustom ? <div className="custom-theme-splotch" style={{ background: (customThemes.find(ct => ct.id === t.id))?.colors['--accent-primary'] }}></div> : <>
                    <div className="color-splotch-1"></div>
                    <div className="color-splotch-2"></div>
                </>}
            </div>
            <span className="theme-name">{t.name}</span>
            {isCustom && (
                 <button className="delete-theme-btn" onClick={(e) => { e.stopPropagation(); onDeleteCustomTheme(t.id); }}>
                    <Icon name="trash"/>
                </button>
            )}
        </div>
    );

    return (
        <header className={`header ${isReadOnlyView ? 'read-only-header' : ''}`}>
            <div className="header-left">
                <div className="app-logo">
                    <Icon name="logo" />
                    <span>SlideSpark AI</span>
                </div>
                {!isReadOnlyView && <>
                    <div className="separator"></div>
                    <button className="icon-btn" onClick={onStartOver} title="Start Over">
                        <Icon name="startOver" />
                    </button>
                </>}
            </div>
            <div className="header-actions">
                {isReadOnlyView ? (
                    <button className="toolbar-button" onClick={onStartOver}>
                        Create Your Own
                    </button>
                ) : (
                    <>
                         <div className="dropdown-container" ref={themeRef}>
                            <button className="toolbar-button" onClick={() => setShowThemeDropdown(!showThemeDropdown)} >
                                Theme <Icon name="chevronDown" />
                            </button>
                             {showThemeDropdown && (
                                <div className="dropdown-menu theme-dropdown-menu">
                                    <div className="theme-grid">
                                        {DEFAULT_THEMES.map(t => renderThemeCard(t))}
                                        {customThemes.map(t => renderThemeCard(t, true))}
                                        <button className="add-theme-btn" onClick={onOpenThemeModal}>
                                            <Icon name="add" />
                                            <span>Create Theme</span>
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                         <div className="separator"></div>
                        <button className="icon-btn" onClick={onPresent} title="Present">
                            <Icon name="present" />
                        </button>
                        <button className="icon-btn" onClick={onPublish} title="Share">
                            <Icon name="share" />
                        </button>
                        <div className="dropdown-container" ref={exportRef}>
                            <button className="toolbar-button" onClick={() => setShowExportDropdown(!showExportDropdown)}>
                                Export <Icon name="chevronDown" />
                            </button>
                             {showExportDropdown && (
                                <div className="dropdown-menu">
                                    <button onClick={onExportToPDF}>Export to PDF</button>
                                    <button onClick={onExportToPPTX} disabled={isExportingPPTX}>
                                        {isExportingPPTX && <span className="mini-spinner"></span>}
                                        Export to PPTX
                                    </button>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </header>
    );
};

const PresentationScreen: React.FC<{
    slides: Slide[],
    currentSlideIndex: number,
    setCurrentSlideIndex: (i: number) => void,
    theme: string,
    setTheme: (t: string) => void,
    customThemes: CustomTheme[],
    onDeleteCustomTheme: (id: string) => void,
    onOpenThemeModal: () => void,
    onExportToPDF: () => void,
    onExportToPPTX: () => void,
    isExportingPPTX: boolean,
    onUpdateSlide: (index: number, field: keyof Slide, value: any) => void,
    dragItem: React.MutableRefObject<number | null>,
    dragOverItem: React.MutableRefObject<number | null>,
    handleDragSort: () => void,
    onRegenerateImage: (index: number) => void,
    onRegenerateChart: (index: number) => void,
    onRegenerateContent: (index: number) => void,
    onEnhance: (index: number) => void,
    slideActionLoading: { [key: string]: boolean },
    onGenerateSpeakerNotes: (index: number) => void,
    onAddSlide: () => void,
    onDeleteSlide: (index: number) => void,
    onPresent: () => void,
    onStartOver: () => void,
    onPublish: () => void,
    isReadOnlyView: boolean,
}> = (props) => {
    const { slides, currentSlideIndex, setCurrentSlideIndex, theme, setTheme, customThemes, onDeleteCustomTheme, onOpenThemeModal, onExportToPDF, onExportToPPTX, isExportingPPTX, onUpdateSlide, dragItem, dragOverItem, handleDragSort, onRegenerateImage, onRegenerateChart, onRegenerateContent, onEnhance, slideActionLoading, onGenerateSpeakerNotes, onAddSlide, onDeleteSlide, onPresent, onStartOver, onPublish, isReadOnlyView } = props;
    const [showNotes, setShowNotes] = useState(false);
    
    return (
        <div className="presentation-container">
            <Header 
                theme={theme} 
                setTheme={setTheme} 
                customThemes={customThemes}
                onDeleteCustomTheme={onDeleteCustomTheme}
                onOpenThemeModal={onOpenThemeModal}
                onPresent={onPresent} 
                onExportToPDF={onExportToPDF} 
                onExportToPPTX={onExportToPPTX}
                isExportingPPTX={isExportingPPTX}
                onStartOver={onStartOver}
                onPublish={onPublish}
                isReadOnlyView={isReadOnlyView}
            />
            <div className="editor-body">
                {!isReadOnlyView && (
                    <aside className="sidebar">
                        <div className="slide-preview-list">
                            {slides.map((slide, index) => (
                                <div
                                    key={index}
                                    className={`slide-preview ${currentSlideIndex === index ? 'active' : ''}`}
                                    onClick={() => setCurrentSlideIndex(index)}
                                    draggable={!isReadOnlyView}
                                    onDragStart={() => dragItem.current = index}
                                    onDragEnter={() => dragOverItem.current = index}
                                    onDragEnd={handleDragSort}
                                    onDragOver={(e) => e.preventDefault()}
                                >
                                    <div className="slide-preview-visual" style={{ backgroundImage: slide.imageUrl && slide.imageUrl !== 'loading' && slide.imageUrl !== 'error' ? `url(${slide.imageUrl})` : 'none' }}>
                                        <div className="slide-preview-overlay">
                                            <span className="slide-number">{index + 1}</span>
                                            <p>{slide.title}</p>
                                        </div>
                                    </div>
                                    {!isReadOnlyView && (
                                        <button className="delete-slide-btn" onClick={(e) => { e.stopPropagation(); onDeleteSlide(index); }} aria-label="Delete slide">
                                            <Icon name="trash" />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                        {!isReadOnlyView && (
                            <button className="add-slide-btn" onClick={onAddSlide}>
                                <Icon name="add" />
                                Add Slide
                            </button>
                        )}
                    </aside>
                )}
                <main className="main-content">
                    <div className="slide-editor">
                        {slides.map((slide, index) => (
                            <div 
                                className={`slide-view-wrapper ${currentSlideIndex === index ? 'active' : ''}`} 
                                key={index}
                            >
                                <div className={`slide-view layout-${slide.layout}`}>
                                    <div className="slide-text-content">
                                        <input
                                            className="slide-title"
                                            value={slide.title}
                                            onChange={(e) => onUpdateSlide(index, 'title', e.target.value)}
                                            aria-label="Slide Title"
                                            readOnly={isReadOnlyView}
                                        />
                                        <textarea
                                            className="slide-body"
                                            value={slide.content.join('\n')}
                                            onChange={(e) => onUpdateSlide(index, 'content', e.target.value.split('\n'))}
                                            aria-label="Slide Content"
                                            readOnly={isReadOnlyView}
                                        />
                                    </div>
                                    <div className="slide-image-content">
                                        {slide.chartData ? (
                                            <>
                                                <ChartComponent data={slide.chartData} theme={theme} />
                                                {!isReadOnlyView && (
                                                    <button className="regenerate-visual-btn icon-btn" onClick={() => onRegenerateChart(index)} disabled={slideActionLoading[`chart-${index}`]} aria-label="Regenerate Chart">
                                                        {slideActionLoading[`chart-${index}`] ? <span className="mini-spinner"></span> : <Icon name="chart" />}
                                                    </button>
                                                )}
                                            </>
                                        ) : slide.imageUrl === 'loading' || slide.imageUrl === 'pending' ? (
                                            <div className="slide-image loading"><div className="spinner"></div></div>
                                        ) : slide.imageUrl === 'error' ? (
                                            <div className="slide-image error"><span>!</span>Failed to load image.</div>
                                        ) : slide.imageUrl ? (
                                            <>
                                                <img src={slide.imageUrl} alt={slide.imagePrompt} className="slide-image" />
                                                {!isReadOnlyView && (
                                                    <button className="regenerate-visual-btn icon-btn" onClick={() => onRegenerateImage(index)} disabled={slideActionLoading[`image-${index}`]} aria-label="Regenerate Image">
                                                        {slideActionLoading[`image-${index}`] ? <span className="mini-spinner"></span> : <Icon name="regenerateImage" />}
                                                    </button>
                                                )}
                                            </>
                                        ) : <div className="slide-image empty"></div>}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                     {!isReadOnlyView && (
                         <div className="slide-controls">
                             <div className="slide-actions">
                                <button className="icon-btn" onClick={() => onRegenerateContent(currentSlideIndex)} disabled={slideActionLoading[`content-${currentSlideIndex}`]} title="Regenerate Content">
                                    {slideActionLoading[`content-${currentSlideIndex}`] ? <span className="mini-spinner"></span> : <Icon name="regenerateContent" />}
                                </button>
                                <button className="icon-btn" onClick={() => onEnhance(currentSlideIndex)} disabled={slideActionLoading[`enhance-${currentSlideIndex}`]} title="Enhance Writing">
                                    {slideActionLoading[`enhance-${currentSlideIndex}`] ? <span className="mini-spinner"></span> : <Icon name="enhance" />}
                                </button>
                                <button className={`icon-btn ${showNotes ? 'active' : ''}`} onClick={() => setShowNotes(!showNotes)} title="Speaker Notes">
                                    <Icon name="notes" />
                                </button>
                            </div>
                            <div className="separator"></div>
                            <div className="layout-selector">
                                <button className={`icon-btn ${slides[currentSlideIndex]?.layout === 'text-left' ? 'active' : ''}`} onClick={() => onUpdateSlide(currentSlideIndex, 'layout', 'text-left')} title="Layout: Text Left">
                                    <Icon name="layoutLeft" />
                                </button>
                                 <button className={`icon-btn ${slides[currentSlideIndex]?.layout === 'text-right' ? 'active' : ''}`} onClick={() => onUpdateSlide(currentSlideIndex, 'layout', 'text-right')} title="Layout: Text Right">
                                    <Icon name="layoutRight" />
                                </button>
                                <button className={`icon-btn ${slides[currentSlideIndex]?.layout === 'image-full' ? 'active' : ''}`} onClick={() => onUpdateSlide(currentSlideIndex, 'layout', 'image-full')} title="Layout: Full Image" disabled={!!slides[currentSlideIndex]?.chartData}>
                                     <Icon name="layoutFull" />
                                </button>
                            </div>
                        </div>
                     )}
                     {slides[currentSlideIndex] && !isReadOnlyView && (
                        <SpeakerNotesPanel 
                            slide={slides[currentSlideIndex]}
                            slideIndex={currentSlideIndex}
                            isOpen={showNotes}
                            onUpdate={(value) => onUpdateSlide(currentSlideIndex, 'speakerNotes', value)}
                            onGenerate={() => onGenerateSpeakerNotes(currentSlideIndex)}
                            isLoading={slideActionLoading[`notes-${currentSlideIndex}`]}
                        />
                     )}
                </main>
            </div>
        </div>
    );
};

const SpeakerNotesPanel: React.FC<{
    slide: Slide;
    slideIndex: number;
    isOpen: boolean;
    onUpdate: (value: string) => void;
    onGenerate: () => void;
    isLoading: boolean;
}> = ({ slide, isOpen, onUpdate, onGenerate, isLoading }) => {
    return (
        <div className={`speaker-notes-panel ${isOpen ? 'open' : ''}`}>
            <div className="notes-header">
                <h3>Speaker Notes</h3>
                <button onClick={onGenerate} disabled={isLoading}>
                    {isLoading ? <span className="mini-spinner"></span> : 'Generate with AI'}
                </button>
            </div>
            <textarea
                value={slide.speakerNotes}
                onChange={(e) => onUpdate(e.target.value)}
                placeholder="Click 'Generate with AI' or type your notes here..."
            />
        </div>
    );
};

const PresentationView: React.FC<{
    slides: Slide[];
    initialIndex: number;
    onExit: () => void;
    isReadOnlyView?: boolean;
}> = ({ slides, initialIndex, onExit, isReadOnlyView = false }) => {
    const [currentIndex, setCurrentIndex] = useState(initialIndex);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowRight' || e.key === ' ') {
                e.preventDefault();
                setCurrentIndex(prev => Math.min(slides.length - 1, prev + 1));
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setCurrentIndex(prev => Math.max(0, prev - 1));
            } else if (e.key === 'Escape') {
                onExit();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [slides.length, onExit]);

    return (
        <div className="presentation-view-container">
             {isReadOnlyView && (
                 <header className="header read-only-header">
                     <div className="header-left">
                        <div className="app-logo">
                            <Icon name="logo" />
                            <span>SlideSpark AI</span>
                        </div>
                    </div>
                    <div className="header-actions">
                        <button className="toolbar-button" onClick={onExit}>
                            Create Your Own
                        </button>
                    </div>
                </header>
            )}
            <div className="presentation-slide-wrapper">
                {slides.map((slide, index) => (
                    <div 
                        key={index} 
                        className="presentation-slide"
                        style={{ transform: `translateX(${(index - currentIndex) * 100}%)` }}
                    >
                         <div className={`slide-view layout-${slide.layout}`}>
                            <div className="slide-text-content">
                                <h1 className="slide-title">{slide.title}</h1>
                                <ul className="slide-body">
                                    {slide.content.map((point, i) => <li key={i}>{point}</li>)}
                                </ul>
                            </div>
                            <div className="slide-image-content">
                                {slide.chartData ? (
                                    <ChartComponent data={slide.chartData} theme={"dark"} />
                                ) : slide.imageUrl && slide.imageUrl !== 'loading' && slide.imageUrl !== 'error' && (
                                    <img src={slide.imageUrl} alt={slide.imagePrompt} className="slide-image" />
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
             {!isReadOnlyView && (
                <div className="presentation-controls">
                    <span>{currentIndex + 1} / {slides.length}</span>
                    <button onClick={onExit} className="exit-presentation-btn" aria-label="Exit presentation">
                        <Icon name="exit" />
                    </button>
                </div>
            )}
        </div>
    );
};

const ThemeCreatorModal: React.FC<{
    onSave: (theme: CustomTheme) => void,
    onClose: () => void
}> = ({ onSave, onClose }) => {
    const [name, setName] = useState('My Custom Theme');
    const [colors, setColors] = useState({
        '--bg-primary': '#121212',
        '--bg-secondary': '#1e1e1e',
        '--text-primary': '#f1f1f1',
        '--text-secondary': '#a0a0a0',
        '--accent-primary': '#3b82f6',
    });
    const modalRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        const handleClickOutside = (e: MouseEvent) => {
            if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [onClose]);

    const handleColorChange = (key: keyof typeof colors, value: string) => {
        setColors(prev => ({...prev, [key]: value}));
    };

    const handleSave = () => {
        if (!name.trim()) return;
        onSave({ id: `custom-${Date.now()}`, name, colors });
    };

    return (
        <div className="modal-overlay">
            <div className="theme-modal" ref={modalRef} style={colors as React.CSSProperties}>
                <h3>Create Custom Theme</h3>
                <div className="form-group">
                    <label>Theme Name</label>
                    <input type="text" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div className="color-pickers">
                    <div className="color-picker-group">
                        <label>Primary BG</label>
                        <input type="color" value={colors['--bg-primary']} onChange={e => handleColorChange('--bg-primary', e.target.value)} />
                    </div>
                     <div className="color-picker-group">
                        <label>Secondary BG</label>
                        <input type="color" value={colors['--bg-secondary']} onChange={e => handleColorChange('--bg-secondary', e.target.value)} />
                    </div>
                     <div className="color-picker-group">
                        <label>Primary Text</label>
                        <input type="color" value={colors['--text-primary']} onChange={e => handleColorChange('--text-primary', e.target.value)} />
                    </div>
                     <div className="color-picker-group">
                        <label>Secondary Text</label>
                        <input type="color" value={colors['--text-secondary']} onChange={e => handleColorChange('--text-secondary', e.target.value)} />
                    </div>
                     <div className="color-picker-group">
                        <label>Accent</label>
                        <input type="color" value={colors['--accent-primary']} onChange={e => handleColorChange('--accent-primary', e.target.value)} />
                    </div>
                </div>
                <div className="modal-actions">
                    <button onClick={onClose} className="cancel-btn">Cancel</button>
                    <button onClick={handleSave} className="save-btn">Save Theme</button>
                </div>
            </div>
        </div>
    );
};

const ShareModal: React.FC<{
    url: string;
    onClose: () => void;
}> = ({ url, onClose }) => {
    const [copied, setCopied] = useState(false);
    const modalRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        const handleClickOutside = (e: MouseEvent) => {
            if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [onClose]);

    const handleCopy = () => {
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="modal-overlay">
            <div className="share-modal" ref={modalRef}>
                <h3>Share Presentation</h3>
                <p>Anyone with this link can view a read-only version of your presentation.</p>
                <div className="share-link-container">
                    <input type="text" readOnly value={url} />
                    <button onClick={handleCopy} className={copied ? 'copied' : ''}>
                        {copied ? 'Copied!' : 'Copy Link'}
                    </button>
                </div>
                 <div className="modal-actions">
                    <button onClick={onClose} className="cancel-btn">Done</button>
                </div>
            </div>
        </div>
    );
};


const root = createRoot(document.getElementById('root')!);
root.render(<App />);